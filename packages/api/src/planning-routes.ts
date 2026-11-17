/**
 * Routes for the planning model: settings, pots and their journal, payday rules and runs,
 * scheduled outflows, balance checkpoints and the free-to-spend number.
 *
 * Reads need `read` scope; every write needs `full` (no new scope was added). Audit rows carry
 * ids and counts only, never amounts or names.
 */
import express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { paise } from '@ledger/core';
import type { LocalDate, PaydayRule } from '@ledger/core';
import { recordAudit } from './auth.ts';
import type { RateLimiter, TokenScope } from './auth.ts';
import type { Database } from './db/schema.ts';
import { HttpError, fail, idText, isoDate, paiseInt, parseWith } from './http-support.ts';
import type { PlanningError } from './planning-service.ts';
import {
  addPotMovement,
  addScheduled,
  applyPaydayRun,
  computeFree,
  createPot,
  currentBalances,
  deleteScheduled,
  getPaydayRules,
  getSettings,
  listPotMovements,
  listPots,
  listScheduled,
  previewPayday,
  setCheckpoint,
  setPaydayRules,
  updatePot,
  updateSettings,
} from './planning-service.ts';

export interface PlanningRouteContext {
  readonly app: express.Express;
  readonly db: Kysely<Database>;
  readonly newId: () => string;
  /** Today's date in India. */
  readonly today: () => LocalDate;
  readonly guard: (need: TokenScope, limiter?: RateLimiter) => RequestHandler;
  readonly actor: (res: Response) => string | null;
}

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  unknown_pot: 404,
  unknown_account: 404,
  run_id_reused: 409,
  no_rules: 409,
};

/** Planning problems are the caller's to fix: 404 for unknown ids, 409 for conflicts, else 422. */
export const planningHttpError = (error: PlanningError): HttpError =>
  new HttpError(STATUS_BY_CODE[error.code] ?? 422, error.code, error.message);

const name = z.string().trim().min(1).max(60);
const jsonBody = express.json({ limit: '10kb' });

const settingsPatch = z.strictObject({
  paydayDay: z.number().int().min(1).max(31).optional(),
  paydayWeekend: z.enum(['none', 'previous-weekday']).optional(),
  cardExposure: z.enum(['all_outstanding', 'due_before_payday']).optional(),
});
const potBody = z.strictObject({
  name,
  kind: z.enum(['buffer', 'bill', 'spend']),
  targetPaise: paiseInt.min(0).optional(),
  dueDate: isoDate.optional(),
  coversCardAccountId: idText.optional(),
});
const potPatch = z.strictObject({
  name: name.optional(),
  targetPaise: paiseInt.min(0).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
});
const movementBody = z.strictObject({
  amountPaise: paiseInt.refine((n) => n !== 0, 'Must not be zero'),
  reason: z.enum(['spend', 'trueup', 'manual']),
  date: isoDate.optional(),
});
const ruleBody = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('fixed'),
    name,
    amountPaise: paiseInt.min(0),
    potId: idText.optional(),
  }),
  z.strictObject({
    kind: z.literal('percent'),
    name,
    basisPoints: z.number().int().min(0).max(10_000),
    potId: idText.optional(),
  }),
  z.strictObject({ kind: z.literal('remainder'), name, potId: idText.optional() }),
]);
const rulesBody = z.strictObject({ rules: z.array(ruleBody).max(30) });
const paydayPreviewBody = z.strictObject({ amountPaise: paiseInt.min(1) });
const paydayApplyBody = z.strictObject({
  runId: idText,
  amountPaise: paiseInt.min(1),
  date: isoDate.optional(),
});
const scheduledBody = z.strictObject({
  name,
  amountPaise: paiseInt.min(1),
  date: isoDate.optional(),
  monthlyDay: z.number().int().min(1).max(31).optional(),
});
const balanceBody = z.strictObject({
  accountId: idText,
  amountPaise: paiseInt,
  date: isoDate.optional(),
});

const toRule = (input: z.output<typeof ruleBody>): PaydayRule => {
  const base = { name: input.name, ...(input.potId === undefined ? {} : { potId: input.potId }) };
  if (input.kind === 'fixed') return { ...base, kind: 'fixed', amountPaise: input.amountPaise };
  if (input.kind === 'percent') return { ...base, kind: 'percent', basisPoints: input.basisPoints };
  return { ...base, kind: 'remainder' };
};

export function registerPlanningRoutes(ctx: PlanningRouteContext): void {
  const { app, db, newId, guard, actor } = ctx;
  const audit = (
    res: Response,
    action: string,
    entity: string,
    entityId?: string,
    detail?: Record<string, number | string | boolean>,
  ): Promise<void> =>
    recordAudit(db, {
      tokenId: actor(res),
      action,
      entity,
      ...(entityId === undefined ? {} : { entityId }),
      ...(detail === undefined ? {} : { detail }),
    });
  const potId = (req: Request): string => parseWith(idText, req.params['id']);

  const settingsView = async () => {
    const s = await getSettings(db);
    return {
      paydayDay: s.payday_day,
      paydayWeekend: s.payday_weekend,
      cardExposure: s.card_exposure,
    };
  };

  app.get('/settings', guard('read'), async (_req, res) => {
    res.json(await settingsView());
  });

  app.patch('/settings', guard('full'), jsonBody, async (req, res) => {
    const body = parseWith(settingsPatch, req.body);
    await updateSettings(db, {
      ...(body.paydayDay === undefined ? {} : { payday_day: body.paydayDay }),
      ...(body.paydayWeekend === undefined ? {} : { payday_weekend: body.paydayWeekend }),
      ...(body.cardExposure === undefined ? {} : { card_exposure: body.cardExposure }),
    });
    await audit(res, 'settings.update', 'settings', undefined, {
      fields: Object.keys(body).length,
    });
    res.json(await settingsView());
  });

  // ---- pots ---------------------------------------------------------------------------------

  app.get('/pots', guard('read'), async (_req, res) => {
    res.json({ items: await listPots(db) });
  });

  app.post('/pots', guard('full'), jsonBody, async (req, res) => {
    const body = parseWith(potBody, req.body);
    const id = await createPot(
      db,
      {
        name: body.name,
        kind: body.kind,
        targetPaise: body.targetPaise === undefined ? undefined : paise(body.targetPaise),
        dueDate: body.dueDate,
        coversCardAccountId: body.coversCardAccountId,
      },
      newId,
    );
    await audit(res, 'pot.create', 'pot', id, { kind: body.kind });
    res.status(201).json({ id });
  });

  app.patch('/pots/:id', guard('full'), jsonBody, async (req, res) => {
    const id = potId(req);
    const body = parseWith(potPatch, req.body);
    const found = await updatePot(db, id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.targetPaise === undefined
        ? {}
        : { targetPaise: body.targetPaise === null ? null : paise(body.targetPaise) }),
      ...(body.dueDate === undefined ? {} : { dueDate: body.dueDate }),
    });
    if (!found) return fail(404, 'unknown_pot', 'No pot with that id');
    await audit(res, 'pot.update', 'pot', id, { fields: Object.keys(body).length });
    const pot = (await listPots(db)).find((p) => p.id === id);
    res.json(pot);
  });

  app.get('/pots/:id/movements', guard('read'), async (req, res) => {
    const id = potId(req);
    if (!(await listPots(db)).some((p) => p.id === id)) {
      return fail(404, 'unknown_pot', 'No pot with that id');
    }
    res.json({ items: await listPotMovements(db, id) });
  });

  app.post('/pots/:id/movements', guard('full'), jsonBody, async (req, res) => {
    const id = potId(req);
    const body = parseWith(movementBody, req.body);
    const movementId = await addPotMovement(
      db,
      {
        potId: id,
        amountPaise: paise(body.amountPaise),
        reason: body.reason,
        date: body.date ?? ctx.today(),
      },
      newId,
    );
    await audit(res, 'pot.movement', 'pot_movement', movementId, { reason: body.reason });
    res.status(201).json({ id: movementId });
  });

  // ---- payday -------------------------------------------------------------------------------

  app.get('/payday/rules', guard('read'), async (_req, res) => {
    res.json({ items: await getPaydayRules(db) });
  });

  app.put('/payday/rules', guard('full'), jsonBody, async (req, res) => {
    const body = parseWith(rulesBody, req.body);
    await setPaydayRules(db, body.rules.map(toRule), newId);
    await audit(res, 'payday.rules.set', 'payday_rules', undefined, { count: body.rules.length });
    res.json({ items: await getPaydayRules(db) });
  });

  app.post('/payday/preview', guard('read'), jsonBody, async (req, res) => {
    const body = parseWith(paydayPreviewBody, req.body);
    res.json(await previewPayday(db, paise(body.amountPaise)));
  });

  app.post('/payday/apply', guard('full'), jsonBody, async (req, res) => {
    const body = parseWith(paydayApplyBody, req.body);
    const outcome = await applyPaydayRun(db, {
      runId: body.runId,
      amountPaise: paise(body.amountPaise),
      date: body.date ?? ctx.today(),
    });
    await audit(res, 'payday.apply', 'payday_run', outcome.runId, { replayed: outcome.replayed });
    res.status(outcome.replayed ? 200 : 201).json(outcome);
  });

  // ---- scheduled outflows -------------------------------------------------------------------

  app.get('/scheduled', guard('read'), async (_req, res) => {
    res.json({ items: await listScheduled(db) });
  });

  app.post('/scheduled', guard('full'), jsonBody, async (req, res) => {
    const body = parseWith(scheduledBody, req.body);
    const id = await addScheduled(
      db,
      {
        name: body.name,
        amountPaise: paise(body.amountPaise),
        date: body.date,
        monthlyDay: body.monthlyDay,
      },
      newId,
    );
    await audit(res, 'scheduled.add', 'scheduled_item', id);
    res.status(201).json({ id });
  });

  app.delete('/scheduled/:id', guard('full'), async (req, res) => {
    const id = parseWith(idText, req.params['id']);
    if (!(await deleteScheduled(db, id))) return fail(404, 'not_found', 'No such scheduled item');
    await audit(res, 'scheduled.delete', 'scheduled_item', id);
    res.status(204).end();
  });

  // ---- balances and the headline number -----------------------------------------------------

  app.get('/balances', guard('read'), async (_req, res) => {
    const { balances } = await currentBalances(db, ctx.today());
    res.json({ items: balances });
  });

  app.post('/balances', guard('full'), jsonBody, async (req, res) => {
    const body = parseWith(balanceBody, req.body);
    const today = ctx.today();
    const date = body.date ?? today;
    if (date > today) {
      return fail(422, 'future_date', 'A balance cannot be recorded for a future date');
    }
    await setCheckpoint(
      db,
      { accountId: body.accountId, date, amountPaise: paise(body.amountPaise) },
      newId,
    );
    await audit(res, 'balance.set', 'account', body.accountId);
    res.status(201).json({ accountId: body.accountId, date });
  });

  app.get('/free', guard('read'), async (_req, res) => {
    const outcome = await computeFree(db, ctx.today());
    if (!outcome.ok) {
      return fail(
        409,
        'missing_balances',
        'Record a current balance for every account first (POST /balances)',
        outcome.missingCheckpoints,
      );
    }
    res.json({ ...outcome.result, balances: outcome.balances, warnings: outcome.warnings });
  });
}
