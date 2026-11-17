/**
 * HTTP API (Express 5 + zod). The single enforcement point for auth, scopes, audit and rate limits.
 *
 * Rules every route follows:
 * - declares the scope it needs (`capture` < `read` < `full`; see auth.ts);
 * - validates the whole request with a strict zod schema (unknown fields are rejected) and never
 *   echoes submitted values back in errors;
 * - never logs memos, counterparties or message bodies; audit rows hold counts and ids only;
 * - returns errors as `{ code, message, details? }`.
 *
 * Import is stateless on purpose: the client sends the same CSV to `/imports` (preview) and
 * `/imports/confirm` (plus any `choices`), and the server recomputes the plan inside the commit
 * transaction, so there is no preview token to expire or tamper with.
 */
import { createHash } from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import {
  DEFAULT_RECONCILE_OPTIONS,
  DEMO_MAPPINGS,
  addDays,
  createCsvImporter,
  monthlySummary,
  parseLocalDate,
  reconcile,
} from '@ledger/core';
import type { CompiledRule, CsvMapping, LocalDate } from '@ledger/core';
import { captureEntry } from './capture-service.ts';
import {
  createRateLimiter,
  createToken,
  listTokens,
  recordAudit,
  revokeToken,
  scopeAllows,
  verifyBearer,
} from './auth.ts';
import type { Principal, RateLimiter, TokenScope } from './auth.ts';
import type { Database } from './db/schema.ts';
import { HttpError, fail, idText, isoDate, parseWith } from './http-support.ts';
import { PlanningError } from './planning-service.ts';
import { planningHttpError, registerPlanningRoutes } from './planning-routes.ts';
import { registerAnalysisRoutes } from './analysis-routes.ts';
import { transactionView } from './transaction-view.ts';
import { confirmImport, planStatement } from './import-service.ts';
import type { ImportRequest, StatementPlan } from './import-service.ts';

export interface AppOptions {
  readonly db: Kysely<Database>;
  readonly newId: () => string;
  readonly now?: () => Date;
  /** CSV layouts the server accepts, by id. Defaults to the fake demo banks. */
  readonly mappings?: readonly CsvMapping[];
  readonly rules?: readonly CompiledRule[];
  /** Requests per window, per token. */
  readonly rateLimits?: {
    readonly capture: number;
    readonly default: number;
    readonly windowMs?: number;
  };
}

/** Today's calendar date in India, whatever the server's own timezone is. */
export function todayInKolkata(now: Date): LocalDate {
  const text = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseLocalDate(text, 'yyyy-mm-dd');
}

const IMPORT_BODY_LIMIT = '2500kb';
const MAX_CSV_CHARS = 2_000_000;

const captureBody = z.strictObject({
  text: z.string().min(1).max(200),
  accountId: idText.optional(),
});
const importBodySchema = z.strictObject({
  accountId: idText,
  mappingId: idText,
  csv: z.string().min(1).max(MAX_CSV_CHARS),
  choices: z.record(z.string().max(400), z.string().max(64)).optional(),
});
const tokenBody = z.strictObject({
  name: z.string().min(1).max(60),
  scope: z.enum(['capture', 'read', 'full']),
});
const transactionsQuery = z.strictObject({
  from: isoDate.optional(),
  to: isoDate.optional(),
  category: z.string().min(1).max(40).optional(),
  q: z.string().min(1).max(80).optional(),
  status: z.enum(['pending', 'posted']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const summaryQuery = z.strictObject({ month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u) });

const escapeLike = (text: string): string => text.replace(/[\\%_]/gu, (c) => `\\${c}`);
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

function monthRange(month: string): { first: LocalDate; last: LocalDate } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    first: parseLocalDate(`${month}-01`, 'yyyy-mm-dd'),
    last: parseLocalDate(`${month}-${String(lastDay).padStart(2, '0')}`, 'yyyy-mm-dd'),
  };
}

function describePlan(plan: StatementPlan) {
  const rowView = (row: { line: number; date: string; amount: number; counterparty: string }) => ({
    line: row.line,
    date: row.date,
    amountPaise: row.amount,
    counterparty: row.counterparty,
  });
  return {
    duplicateCount: plan.duplicateCount,
    toInsert: plan.toInsert.map((k) => ({ rowKey: k.identity, ...rowView(k.row) })),
    merges: plan.merges.map((m) => ({
      rowKey: m.keyed.identity,
      pendingId: m.pendingId,
      ...rowView(m.keyed.row),
    })),
    ambiguous: plan.ambiguous.map((a) => ({
      rowKey: a.rowKey,
      pendingIds: a.pendingIds,
      ...rowView(a.row),
    })),
  };
}

export function createApp(options: AppOptions): express.Express {
  const { db, newId } = options;
  const now = options.now ?? (() => new Date());
  const mappings = new Map((options.mappings ?? DEMO_MAPPINGS).map((m) => [m.id, m]));
  const windowMs = options.rateLimits?.windowMs ?? 60_000;
  const captureLimiter: RateLimiter = createRateLimiter({
    limit: options.rateLimits?.capture ?? 60,
    windowMs,
  });
  const defaultLimiter: RateLimiter = createRateLimiter({
    limit: options.rateLimits?.default ?? 300,
    windowMs,
  });

  const principals = new WeakMap<Response, Principal>();
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    next();
  });

  const guard =
    (need: TokenScope, limiter: RateLimiter = defaultLimiter): RequestHandler =>
    async (req, res, next) => {
      const principal = await verifyBearer(db, req.header('authorization'));
      if (principal === undefined) {
        res.set('WWW-Authenticate', 'Bearer');
        return fail(401, 'unauthorized', 'A valid API token is required');
      }
      if (!scopeAllows(principal.scope, need)) {
        return fail(403, 'forbidden', `This token cannot use this endpoint (needs ${need} scope)`);
      }
      if (!limiter.hit(principal.id)) {
        res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        return fail(429, 'rate_limited', 'Too many requests, slow down');
      }
      principals.set(res, principal);
      next();
    };
  const actor = (res: Response): string | null => principals.get(res)?.id ?? null;

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    '/capture',
    guard('capture', captureLimiter),
    express.json({ limit: '10kb' }),
    async (req, res) => {
      const body = parseWith(captureBody, req.body);
      const result = await captureEntry(
        db,
        body.text,
        { today: todayInKolkata(now()) },
        newId,
        body.accountId,
      );
      if (!result.ok) return fail(422, 'invalid_capture', result.error);
      await recordAudit(db, {
        tokenId: actor(res),
        action: 'capture.create',
        entity: 'transaction',
        entityId: result.id,
      });
      res.status(201).json({
        id: result.id,
        entry: {
          date: result.entry.date,
          amountPaise: result.entry.amount,
          method: result.entry.method,
          category: result.entry.category,
          kind: result.entry.kind,
          memo: result.entry.memo,
          status: result.entry.status,
        },
      });
    },
  );

  /** Parses the uploaded CSV into an import request; shared by preview and confirm. */
  const buildImport = (body: z.output<typeof importBodySchema>) => {
    const mapping = mappings.get(body.mappingId);
    if (mapping === undefined) return fail(400, 'unknown_mapping', 'No CSV layout with that id');
    const parsed = createCsvImporter(mapping).parse(body.csv);
    const request: ImportRequest = {
      accountId: body.accountId,
      source: 'csv',
      contentSha256: sha256(body.csv),
      rows: parsed.rows,
      ...(options.rules === undefined ? {} : { rules: options.rules }),
      ...(body.choices === undefined ? {} : { choices: new Map(Object.entries(body.choices)) }),
    };
    return { request, issues: parsed.issues };
  };
  const accountExists = async (accountId: string): Promise<void> => {
    const found = await db
      .selectFrom('accounts')
      .select('id')
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (found === undefined) fail(404, 'unknown_account', 'No account with that id');
  };

  app.post(
    '/imports',
    guard('full'),
    express.json({ limit: IMPORT_BODY_LIMIT }),
    async (req, res) => {
      const { request, issues } = buildImport(parseWith(importBodySchema, req.body));
      await accountExists(request.accountId);
      const plan = await planStatement(db, request);
      res.json({ ...describePlan(plan), issues });
    },
  );

  app.post(
    '/imports/confirm',
    guard('full'),
    express.json({ limit: IMPORT_BODY_LIMIT }),
    async (req, res) => {
      const { request, issues } = buildImport(parseWith(importBodySchema, req.body));
      await accountExists(request.accountId);
      if (issues.length > 0) {
        return fail(
          422,
          'parse_issues',
          'The file has rows that could not be read; nothing was imported',
          issues,
        );
      }
      const outcome = await confirmImport(db, request, newId);
      await recordAudit(db, {
        tokenId: actor(res),
        action: 'import.confirm',
        entity: 'import_batch',
        ...(outcome.batchId === null ? {} : { entityId: outcome.batchId }),
        detail: {
          inserted: outcome.inserted,
          merged: outcome.merged,
          duplicates: outcome.duplicates,
          held: outcome.held,
        },
      });
      res.json(outcome);
    },
  );

  app.get('/transactions', guard('read'), async (req, res) => {
    const q = parseWith(transactionsQuery, req.query);
    let query = db.selectFrom('transactions').selectAll();
    if (q.from !== undefined) query = query.where('date', '>=', q.from);
    if (q.to !== undefined) query = query.where('date', '<=', q.to);
    if (q.category !== undefined) query = query.where('category', '=', q.category);
    if (q.status !== undefined) query = query.where('status', '=', q.status);
    if (q.q !== undefined) {
      const pattern = `%${escapeLike(q.q)}%`;
      query = query.where((eb) =>
        eb.or([eb('counterparty', 'ilike', pattern), eb('memo', 'ilike', pattern)]),
      );
    }
    const rows = await query.orderBy('date', 'desc').orderBy('id').limit(q.limit).execute();
    res.json({
      items: rows.map(transactionView),
    });
  });

  app.get('/summary', guard('read'), async (req, res) => {
    const { month } = parseWith(summaryQuery, req.query);
    const { first, last } = monthRange(month);
    // Pull a margin around the month so a bundle straddling the boundary is seen whole.
    const margin = DEFAULT_RECONCILE_OPTIONS.windowDays;
    const rows = await db
      .selectFrom('transactions')
      .select(['id', 'account_id', 'date', 'amount', 'counterparty', 'category', 'kind'])
      .where('date', '>=', addDays(first, -margin))
      .where('date', '<=', addDays(last, margin))
      .execute();
    const { bundles } = reconcile(
      rows.map((r) => ({
        id: r.id,
        accountId: r.account_id,
        date: r.date,
        amount: r.amount,
        counterparty: r.counterparty,
        kind: r.kind,
      })),
    );
    const summary = monthlySummary(
      month,
      rows.map((r) => ({
        id: r.id,
        date: r.date,
        amount: r.amount,
        kind: r.kind,
        ...(r.category === null ? {} : { category: r.category }),
      })),
      { bundles },
    );
    res.json(summary);
  });

  app.get('/tokens', guard('full'), async (_req, res) => {
    res.json({ items: await listTokens(db) });
  });

  app.post('/tokens', guard('full'), express.json({ limit: '10kb' }), async (req, res) => {
    const body = parseWith(tokenBody, req.body);
    const created = await createToken(db, body, newId);
    await recordAudit(db, {
      tokenId: actor(res),
      action: 'token.create',
      entity: 'api_token',
      entityId: created.id,
      detail: { scope: body.scope },
    });
    res
      .status(201)
      .json({ id: created.id, name: body.name, scope: body.scope, token: created.secret });
  });

  app.delete('/tokens/:id', guard('full'), async (req, res) => {
    const id = parseWith(idText, req.params['id']);
    if (!(await revokeToken(db, id))) return fail(404, 'not_found', 'No active token with that id');
    await recordAudit(db, {
      tokenId: actor(res),
      action: 'token.revoke',
      entity: 'api_token',
      entityId: id,
    });
    res.status(204).end();
  });

  const routeContext = {
    app,
    db,
    newId,
    today: () => todayInKolkata(now()),
    guard,
    actor,
  };
  registerPlanningRoutes(routeContext);
  registerAnalysisRoutes(routeContext);

  app.use((_req, _res, next) => {
    next(new HttpError(404, 'not_found', 'No such endpoint'));
  });

  // Express recognises error handlers by their four parameters, so `next` must stay in the signature.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((thrown: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const err = thrown instanceof PlanningError ? planningHttpError(thrown) : thrown;
    if (err instanceof HttpError) {
      res.status(err.status).json({
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      });
      return;
    }
    const kind = typeof err === 'object' && err !== null && 'type' in err ? String(err.type) : '';
    if (kind === 'entity.too.large') {
      res.status(413).json({ code: 'too_large', message: 'Request body is too large' });
      return;
    }
    if (kind === 'entity.parse.failed') {
      res.status(400).json({ code: 'invalid_json', message: 'Request body is not valid JSON' });
      return;
    }
    // Class name only: error messages can contain statement text.
    process.stderr.write(`Unhandled error: ${err instanceof Error ? err.name : typeof err}\n`);
    res.status(500).json({ code: 'internal', message: 'Something went wrong' });
  });

  return app;
}
