/**
 * Analysis routes: forecast, "can I afford this?", the reconcile review queue, and fixing a
 * transaction's category or kind.
 *
 * `POST /simulate` is a calculation, not a write, so it needs only `read` scope. The one write here
 * (`PATCH /transactions/:id`) needs `full`. Audit rows carry ids and field counts only.
 */
import { z } from 'zod';
import { DEFAULT_FORECAST_OPTIONS, TX_KINDS, addDays, paise } from '@ledger/core';
import { recordAudit } from './auth.ts';
import {
  forecastFor,
  reconcileRange,
  runSimulation,
  updateTransaction,
} from './analysis-service.ts';
import {
  fail,
  idText,
  isoDate,
  jsonBody,
  missingBalances,
  paiseInt,
  parseWith,
} from './http-support.ts';
import type { RouteContext } from './http-support.ts';
import { transactionView } from './transaction-view.ts';

const forecastQuery = z.strictObject({
  windowDays: z.coerce.number().int().min(3).max(60).default(DEFAULT_FORECAST_OPTIONS.windowDays),
  estimator: z.enum(['mean', 'median', 'trimmed-mean']).default(DEFAULT_FORECAST_OPTIONS.estimator),
});
const simulateBody = z.strictObject({
  amountPaise: paiseInt.min(1),
  method: z.enum(['upi', 'card', 'slice_in_3']),
  cardAccountId: idText.optional(),
});
const reconcileQuery = z.strictObject({ from: isoDate.optional(), to: isoDate.optional() });
const transactionPatch = z
  .strictObject({
    category: z.string().trim().min(1).max(40).nullable().optional(),
    kind: z.enum(TX_KINDS).optional(),
  })
  .refine((p) => p.category !== undefined || p.kind !== undefined, 'Nothing to change');

const RECONCILE_DEFAULT_DAYS = 30;
const RECONCILE_MAX_DAYS = 180;

export function registerAnalysisRoutes(ctx: RouteContext): void {
  const { app, db, guard, actor } = ctx;

  app.get('/forecast', guard('read'), async (req, res) => {
    const query = parseWith(forecastQuery, req.query);
    const outcome = await forecastFor(db, ctx.today(), {
      windowDays: query.windowDays,
      estimator: query.estimator,
      trimTopDays: DEFAULT_FORECAST_OPTIONS.trimTopDays,
    });
    if (!outcome.ok) return missingBalances(outcome.missingCheckpoints);
    res.json({
      freePaise: outcome.freePaise,
      nextPayday: outcome.nextPayday,
      windowDays: query.windowDays,
      estimator: query.estimator,
      ...outcome.forecast,
    });
  });

  app.post('/simulate', guard('read'), jsonBody, async (req, res) => {
    const body = parseWith(simulateBody, req.body);
    const outcome = await runSimulation(db, ctx.today(), {
      amountPaise: paise(body.amountPaise),
      method: body.method,
      cardAccountId: body.cardAccountId,
    });
    if (!outcome.ok) return missingBalances(outcome.missingCheckpoints);
    res.json({ ...outcome.result, assumptions: outcome.assumptions });
  });

  app.get('/reconcile', guard('read'), async (req, res) => {
    const query = parseWith(reconcileQuery, req.query);
    const to = query.to ?? ctx.today();
    const from = query.from ?? addDays(to, -(RECONCILE_DEFAULT_DAYS - 1));
    if (from > to) return fail(422, 'invalid_range', '`from` must not be after `to`');
    if (addDays(from, RECONCILE_MAX_DAYS) < to) {
      return fail(
        422,
        'range_too_long',
        `Ask for at most ${String(RECONCILE_MAX_DAYS)} days at a time`,
      );
    }
    res.json(await reconcileRange(db, from, to));
  });

  app.patch('/transactions/:id', guard('full'), jsonBody, async (req, res) => {
    const id = parseWith(idText, req.params['id']);
    const body = parseWith(transactionPatch, req.body);
    const row = await updateTransaction(db, id, {
      ...(body.category === undefined ? {} : { category: body.category }),
      ...(body.kind === undefined ? {} : { kind: body.kind }),
    });
    if (row === undefined) return fail(404, 'not_found', 'No transaction with that id');
    await recordAudit(db, {
      tokenId: actor(res),
      action: 'transaction.update',
      entity: 'transaction',
      entityId: id,
      detail: { fields: Object.keys(body).length },
    });
    res.json(transactionView(row));
  });
}
