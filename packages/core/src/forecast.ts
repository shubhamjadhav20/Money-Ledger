/**
 * Spend forecast to next payday. PLAN.md rule 6.
 *
 * Burn uses RECONCILED spend: a bundle counts once at its net (open bundles count as netted, per
 * the M3 decision), so a refunded purchase or a friend's share does not inflate burn. Transfers,
 * income and fixed items (rent, SIP...) are excluded; fixed items are planned in pots instead.
 * Daily burn is rounded UP and runway DOWN, so the forecast errs on the safe side.
 */
import { addDays, daysBetween } from './dates.ts';
import type { LocalDate } from './dates.ts';
import { isPurchaseFlow } from './domain.ts';
import { paise } from './money.ts';
import type { Paise } from './money.ts';
import type { ReconcileResult, ReconcileTx } from './reconcile.ts';

export interface SpendEvent {
  readonly date: LocalDate;
  /** Negative = money spent. Positive events are ignored by burn. */
  readonly amountPaise: Paise;
  readonly fixed?: boolean;
}

export type BurnEstimator = 'mean' | 'median' | 'trimmed-mean';

export interface ForecastOptions {
  /** Trailing days, today included. */
  readonly windowDays: number;
  readonly estimator: BurnEstimator;
  /** For trimmed-mean: how many of the biggest days to drop. */
  readonly trimTopDays: number;
}

export const DEFAULT_FORECAST_OPTIONS: ForecastOptions = {
  windowDays: 14,
  estimator: 'mean',
  trimTopDays: 1,
};

/** Turn transactions + their reconciliation into spend events (one per bundle or single debit). */
export function spendEvents(
  txs: readonly ReconcileTx[],
  result: ReconcileResult,
  fixedTxIds: ReadonlySet<string> = new Set(),
): SpendEvent[] {
  const byId = new Map(txs.map((t) => [t.id, t]));
  const events: SpendEvent[] = [];

  for (const bundle of result.bundles) {
    if (bundle.netPaise >= 0) continue;
    const dates = bundle.txIds
      .map((id) => byId.get(id)?.date)
      .filter((d): d is LocalDate => d !== undefined);
    const latest = dates.reduce((a, b) => (b > a ? b : a));
    events.push({ date: latest, amountPaise: bundle.netPaise });
  }

  const loose = [...result.singles, ...result.unmatched.map((u) => u.txId)];
  for (const id of loose) {
    const t = byId.get(id);
    if (t === undefined || t.amount >= 0 || !isPurchaseFlow(t.kind)) continue;
    events.push({
      date: t.date,
      amountPaise: t.amount,
      ...(fixedTxIds.has(id) ? { fixed: true } : {}),
    });
  }
  return events;
}

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Spend per day (positive paise), from daily totals over the trailing window. */
export function dailyBurn(
  events: readonly SpendEvent[],
  today: LocalDate,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): Paise {
  const first = addDays(today, -(options.windowDays - 1));
  const totals = new Array<bigint>(options.windowDays).fill(0n);
  for (const e of events) {
    if (e.fixed === true || e.amountPaise >= 0 || e.date < first || e.date > today) continue;
    const index = daysBetween(first, e.date);
    totals[index] = (totals[index] ?? 0n) - BigInt(e.amountPaise);
  }

  const sorted = [...totals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let burn: bigint;
  if (options.estimator === 'median') {
    const mid = Math.floor(sorted.length / 2);
    burn =
      sorted.length % 2 === 1
        ? (sorted[mid] ?? 0n)
        : ceilDiv((sorted[mid - 1] ?? 0n) + (sorted[mid] ?? 0n), 2n);
  } else {
    const kept =
      options.estimator === 'trimmed-mean'
        ? sorted.slice(0, Math.max(1, sorted.length - options.trimTopDays))
        : sorted;
    burn = ceilDiv(
      kept.reduce((s, v) => s + v, 0n),
      BigInt(kept.length),
    );
  }
  return paise(Number(burn));
}

export interface Forecast {
  readonly burnPaisePerDay: Paise;
  readonly daysToPayday: number;
  /** Free money expected to be left on payday. */
  readonly projectedFreePaise: Paise;
  /** Whole days the current free money lasts at this burn; null when burn is zero. */
  readonly runwayDays: number | null;
}

export function forecastToPayday(input: {
  readonly freePaise: Paise;
  readonly burnPaisePerDay: Paise;
  readonly today: LocalDate;
  readonly nextPayday: LocalDate;
}): Forecast {
  const days = daysBetween(input.today, input.nextPayday);
  const free = BigInt(input.freePaise);
  const burn = BigInt(input.burnPaisePerDay);
  return {
    burnPaisePerDay: input.burnPaisePerDay,
    daysToPayday: days,
    projectedFreePaise: paise(Number(free - burn * BigInt(days))),
    runwayDays: burn === 0n ? null : free <= 0n ? 0 : Number(free / burn),
  };
}
