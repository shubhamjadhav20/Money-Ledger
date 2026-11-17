/**
 * Read-side analysis on top of the ledger: spend forecast, "can I afford this?", the reconcile
 * review queue, and the one edit users need on a transaction (category / kind).
 * Everything numeric is delegated to core; this file only gathers rows and wires them in.
 */
import {
  DEFAULT_RECONCILE_OPTIONS,
  SLICE_IN_3,
  addDays,
  dailyBurn,
  forecastToPayday,
  reconcile,
  simulatePurchase,
  spendEvents,
} from '@ledger/core';
import type {
  Bundle,
  Forecast,
  ForecastOptions,
  LocalDate,
  Paise,
  ReconcileTx,
  SimulationResult,
  TxKind,
  Unmatched,
} from '@ledger/core';
import type { Kysely, Selectable } from 'kysely';
import type { Database, TransactionsTable } from './db/schema.ts';
import { PlanningError, computeFree, getSettings } from './planning-service.ts';
import type { FreeOutcome } from './planning-service.ts';

type Missing = Extract<FreeOutcome, { ok: false }>;

async function loadReconcileInput(
  db: Kysely<Database>,
  from: LocalDate,
  to: LocalDate,
): Promise<ReconcileTx[]> {
  const rows = await db
    .selectFrom('transactions')
    .select(['id', 'account_id', 'date', 'amount', 'counterparty', 'kind'])
    .where('date', '>=', from)
    .where('date', '<=', to)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    date: r.date,
    amount: r.amount,
    counterparty: r.counterparty,
    kind: r.kind,
  }));
}

// ---- forecast -------------------------------------------------------------------------------

export type ForecastOutcome =
  | {
      readonly ok: true;
      readonly forecast: Forecast;
      readonly freePaise: Paise;
      readonly nextPayday: LocalDate;
    }
  | Missing;

/**
 * Burn comes from reconciled spend over the trailing window (a refunded purchase counts at its
 * net), so it is computed from the same bundles the reconcile screen shows. Rows dated after
 * today are left out: a future-dated entry must not hide a purchase that already happened.
 */
export async function forecastFor(
  db: Kysely<Database>,
  today: LocalDate,
  options: ForecastOptions,
): Promise<ForecastOutcome> {
  const free = await computeFree(db, today);
  if (!free.ok) return free;
  const windowStart = addDays(today, -(options.windowDays - 1));
  const margin = DEFAULT_RECONCILE_OPTIONS.windowDays;
  const txs = await loadReconcileInput(db, addDays(windowStart, -margin), today);
  const events = spendEvents(txs, reconcile(txs));
  const forecast = forecastToPayday({
    freePaise: free.result.freePaise,
    burnPaisePerDay: dailyBurn(events, today, options),
    today,
    nextPayday: free.result.nextPayday,
  });
  return {
    ok: true,
    forecast,
    freePaise: free.result.freePaise,
    nextPayday: free.result.nextPayday,
  };
}

// ---- simulate -------------------------------------------------------------------------------

export type SimulateMethod = 'upi' | 'card' | 'slice_in_3';

export type SimulateOutcome =
  | { readonly ok: true; readonly result: SimulationResult; readonly assumptions: string[] }
  | Missing;

export async function runSimulation(
  db: Kysely<Database>,
  today: LocalDate,
  input: {
    readonly amountPaise: Paise;
    readonly method: SimulateMethod;
    readonly cardAccountId?: string | undefined;
  },
): Promise<SimulateOutcome> {
  const free = await computeFree(db, today);
  if (!free.ok) return free;
  const settings = await getSettings(db);

  let card:
    { name: string; cycle: NonNullable<(typeof free.balances)[number]['cycle']> } | undefined;
  if (input.method !== 'upi') {
    const cards = free.balances.filter((b) => b.kind === 'card');
    let chosen: (typeof cards)[number] | undefined;
    if (input.cardAccountId !== undefined) {
      const named = free.balances.find((b) => b.accountId === input.cardAccountId);
      if (named === undefined)
        throw new PlanningError('unknown_account', 'No account with that id');
      if (named.kind !== 'card')
        throw new PlanningError('wrong_account_kind', 'That account is not a card account');
      chosen = named;
    } else if (cards.length === 1) {
      chosen = cards[0];
    }
    if (chosen === undefined) {
      throw new PlanningError('card_required', 'Say which card with cardAccountId');
    }
    if (chosen.cycle === null) {
      throw new PlanningError(
        'card_cycle_missing',
        `${chosen.name} has no statement day and due day set`,
      );
    }
    card = { name: chosen.name, cycle: chosen.cycle };
  }

  const result = simulatePurchase(input.amountPaise, input.method, {
    today,
    freePaise: free.result.freePaise,
    nextPayday: free.result.nextPayday,
    cardExposure: settings.card_exposure,
    ...(card === undefined ? {} : { card }),
    presets: [SLICE_IN_3],
  });
  const assumptions =
    input.method === 'slice_in_3'
      ? [
          'Slice in 3 terms (minimum amount, fees) are not verified yet: no minimum and no fee are assumed.',
        ]
      : [];
  return { ok: true, result, assumptions };
}

// ---- reconcile review queue -----------------------------------------------------------------

export interface ReconcileView {
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly bundles: Bundle[];
  readonly unmatched: Unmatched[];
  /** Transactions with no candidate at all (ordinary activity). */
  readonly singleCount: number;
  /** Every transaction a bundle or review item refers to, by id. */
  readonly transactions: Record<
    string,
    { id: string; accountId: string; date: LocalDate; amountPaise: Paise; counterparty: string }
  >;
}

/**
 * Reconciles a window of the ledger. A margin on each side is pulled so a pair that straddles the
 * edge is seen whole; only bundles and review items touching the requested range are returned.
 */
export async function reconcileRange(
  db: Kysely<Database>,
  from: LocalDate,
  to: LocalDate,
): Promise<ReconcileView> {
  const margin = DEFAULT_RECONCILE_OPTIONS.windowDays;
  const txs = await loadReconcileInput(db, addDays(from, -margin), addDays(to, margin));
  const byId = new Map(txs.map((t) => [t.id, t]));
  const inRange = (id: string): boolean => {
    const date = byId.get(id)?.date;
    return date !== undefined && date >= from && date <= to;
  };
  const result = reconcile(txs);
  const bundles = result.bundles.filter((b) => b.txIds.some(inRange));
  const unmatched = result.unmatched.filter((u) => inRange(u.txId));

  const referenced = new Set<string>([
    ...bundles.flatMap((b) => b.txIds),
    ...unmatched.flatMap((u) => [u.txId, ...u.relatedTxIds]),
  ]);
  const transactions: ReconcileView['transactions'] = {};
  for (const id of referenced) {
    const t = byId.get(id);
    if (t !== undefined) {
      transactions[id] = {
        id,
        accountId: t.accountId,
        date: t.date,
        amountPaise: t.amount,
        counterparty: t.counterparty,
      };
    }
  }
  return {
    from,
    to,
    bundles,
    unmatched,
    singleCount: result.singles.filter(inRange).length,
    transactions,
  };
}

// ---- editing a transaction ------------------------------------------------------------------

/** Fixes a category or kind. Returns undefined when there is no such transaction. */
export async function updateTransaction(
  db: Kysely<Database>,
  id: string,
  patch: { readonly category?: string | null; readonly kind?: TxKind },
): Promise<Selectable<TransactionsTable> | undefined> {
  const set: Partial<{ category: string | null; kind: TxKind }> = {};
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.kind !== undefined) set.kind = patch.kind;
  if (Object.keys(set).length > 0) {
    await db.updateTable('transactions').set(set).where('id', '=', id).execute();
  }
  return db.selectFrom('transactions').selectAll().where('id', '=', id).executeTakeFirst();
}
