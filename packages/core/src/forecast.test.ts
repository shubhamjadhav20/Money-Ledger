import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, localDate } from './dates.ts';
import { DEFAULT_FORECAST_OPTIONS, dailyBurn, forecastToPayday, spendEvents } from './forecast.ts';
import type { SpendEvent } from './forecast.ts';
import { paise } from './money.ts';
import { reconcile } from './reconcile.ts';
import type { ReconcileTx } from './reconcile.ts';

const today = localDate(2026, 11, 17);
const daysAgo = (n: number) => addDays(today, -n);
const spend = (n: number, rupees: number, fixed = false): SpendEvent => ({
  date: daysAgo(n),
  amountPaise: paise(-rupees * 100),
  ...(fixed ? { fixed } : {}),
});

describe('spendEvents()', () => {
  const tx = (
    id: string,
    n: number,
    rupees: number,
    counterparty: string,
    extra: Partial<ReconcileTx> = {},
  ): ReconcileTx => ({
    id,
    accountId: 'bank',
    date: daysAgo(n),
    amount: paise(rupees * 100),
    counterparty,
    ...extra,
  });

  it('uses bundle nets (open bundles count as netted), single debits and review-queue debits', () => {
    const txs = [
      tx('buy', 5, -999, 'BOOKSTORE'),
      tx('refund', 3, 999, 'BOOKSTORE REFUND'), // settled bundle, net 0: no spend
      tx('in', 4, 7250, 'FRIEND'),
      tx('out', 4, -7246, 'SHOP'), // open bundle, net +4: no spend
      tx('lunch', 2, -250, 'CAFE'), // single
      tx('salary', 1, 85_000, 'ACME'), // income: never burn
      tx('cc', 1, -5000, 'CC PAYMENT', { kind: 'transfer' }), // transfer: never burn
      tx('d', 6, -300, 'X'),
      tx('c1', 6, 300, 'X'),
      tx('c2', 6, 300, 'X'), // ambiguous trio: the debit still counts
    ];
    const events = spendEvents(txs, reconcile(txs));
    expect(events.map((e) => e.amountPaise).sort((a, b) => a - b)).toEqual([-30_000, -25_000]);
  });

  it('dates a bundle at its latest member and marks fixed transactions', () => {
    const txs = [
      tx('a', 5, -1000, 'SHOP'),
      tx('b', 3, 100, 'SHOP REFUND'),
      tx('rent', 2, -18_000, 'RENT'),
    ];
    const events = spendEvents(
      txs,
      reconcile(txs, {
        windowDays: 10,
        tolerance: { absPaise: 100_000, basisPoints: 0 },
        settleMinSimilarity: 0.5,
        maxGroupSide: 8,
      }),
      new Set(['rent']),
    );
    expect(events).toContainEqual({ date: daysAgo(3), amountPaise: -90_000 });
    expect(events).toContainEqual({ date: daysAgo(2), amountPaise: -1_800_000, fixed: true });
  });
});

describe('dailyBurn()', () => {
  const window = { ...DEFAULT_FORECAST_OPTIONS, windowDays: 4 };

  it('averages spend per day over the window (today included), rounding up', () => {
    // 4 days: 100 + 0 + 50 + 0.01 rupees = 15001 paise / 4 = 3750.25 -> 3751
    const events = [spend(0, 100), spend(2, 50), { date: daysAgo(3), amountPaise: paise(-1) }];
    expect(dailyBurn(events, today, window)).toBe(3751);
  });

  it('ignores fixed items, income and anything outside the window', () => {
    const events = [
      spend(0, 40),
      spend(1, 18_000, true),
      spend(4, 999),
      { date: today, amountPaise: paise(5000) },
    ];
    expect(dailyBurn(events, today, window)).toBe(1000);
  });

  it('median and trimmed mean resist one lumpy purchase', () => {
    const events = [spend(0, 100), spend(1, 100), spend(2, 100), spend(3, 20_000)];
    expect(dailyBurn(events, today, window)).toBe(507_500);
    expect(dailyBurn(events, today, { ...window, estimator: 'median' })).toBe(10_000);
    expect(dailyBurn(events, today, { ...window, estimator: 'trimmed-mean', trimTopDays: 1 })).toBe(
      10_000,
    );
  });

  it('is zero with no spend', () => {
    expect(dailyBurn([], today, window)).toBe(0);
  });
});

describe('forecastToPayday()', () => {
  it('projects free money at payday and runway in days', () => {
    expect(
      forecastToPayday({
        freePaise: paise(1_000_000),
        burnPaisePerDay: paise(60_000),
        today,
        nextPayday: localDate(2026, 12, 1),
      }),
    ).toEqual({
      burnPaisePerDay: 60_000,
      daysToPayday: 14,
      projectedFreePaise: 160_000,
      runwayDays: 16,
    });
  });

  it('runway is 0 when already negative and null when there is no burn', () => {
    const payday = localDate(2026, 12, 1);
    expect(
      forecastToPayday({
        freePaise: paise(-1),
        burnPaisePerDay: paise(100),
        today,
        nextPayday: payday,
      }).runwayDays,
    ).toBe(0);
    expect(
      forecastToPayday({
        freePaise: paise(500),
        burnPaisePerDay: paise(0),
        today,
        nextPayday: payday,
      }).runwayDays,
    ).toBeNull();
  });

  it('projection never loses paise (exact integer arithmetic)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 62 }),
        (free, burn, days) => {
          const f = forecastToPayday({
            freePaise: paise(free),
            burnPaisePerDay: paise(burn),
            today,
            nextPayday: addDays(today, days),
          });
          expect(f.projectedFreePaise).toBe(free - burn * days);
        },
      ),
    );
  });
});
