import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { localDate } from './dates.ts';
import { TX_KINDS, isPurchaseFlow } from './domain.ts';
import type { TxKind } from './domain.ts';
import { paise } from './money.ts';
import { monthlySummary } from './summary.ts';
import type { SummaryTx } from './summary.ts';

const tx = (
  id: string,
  day: number,
  rupees: number,
  kind: TxKind,
  category?: string,
  month = 11,
): SummaryTx => ({
  id,
  date: localDate(2026, month, day),
  amount: paise(Math.round(rupees * 100)),
  kind,
  ...(category === undefined ? {} : { category }),
});

describe('monthlySummary(): the "where did my salary go" view', () => {
  const november = [
    tx('salary', 5, 48_700, 'income', 'salary'),
    tx('sip', 10, -25_000, 'investment', 'sip'),
    tx('mummy', 5, -10_000, 'family', 'household'),
    tx('bill', 5, -3_053.65, 'transfer', 'card-bill'),
    tx('spotify', 6, -229, 'spend', 'subscriptions'),
    tx('recharge', 8, -350, 'spend', 'recharge'),
    tx('chai', 9, -20, 'spend', 'food'),
    tx('lunch', 9, -180, 'spend', 'food'),
    tx('mystery', 11, -100, 'spend'),
    tx('october', 28, -999, 'spend', 'food', 10), // other month: ignored
  ];
  const summary = monthlySummary('2026-11', november, {
    fixedCategories: new Set(['subscriptions', 'recharge']),
  });

  it('splits money by kind, with spend separate from investments and family', () => {
    expect(summary.incomePaise).toBe(4_870_000);
    expect(summary.investedPaise).toBe(2_500_000);
    expect(summary.familyPaise).toBe(1_000_000);
    expect(summary.spendPaise).toBe(87_900); // 229 + 350 + 20 + 180 + 100 = ₹879
  });

  it('keeps card-bill payments out of spend and reports what is left over', () => {
    expect(summary.byKind.transfer).toEqual({ netPaise: -305_365, count: 1 });
    expect(summary.leftoverPaise).toBe(
      summary.incomePaise - summary.investedPaise - summary.familyPaise - summary.spendPaise,
    );
  });

  it('breaks spend into categories (largest first) and fixed/variable', () => {
    expect(summary.spendByCategory.map((c) => c.category)).toEqual([
      'recharge',
      'subscriptions',
      'food',
      'Uncategorised',
    ]);
    expect(summary.fixedSpendPaise + summary.variableSpendPaise).toBe(summary.spendPaise);
    expect(summary.fixedSpendPaise).toBe(22_900 + 35_000);
  });
});

describe('monthlySummary(): edge cases', () => {
  it('rejects a malformed month', () => {
    expect(() => monthlySummary('2026-13', [])).toThrow('month');
    expect(() => monthlySummary('Nov 2026', [])).toThrow('month');
  });

  it('treats a refund of a purchase as negative spend in the same category', () => {
    const s = monthlySummary('2026-11', [
      tx('buy', 2, -999, 'spend', 'books'),
      tx('refund', 3, 999, 'spend', 'books'),
    ]);
    expect(s.spendPaise).toBe(0);
    expect(s.spendByCategory).toEqual([{ category: 'books', spentPaise: 0, fixed: false }]);
  });

  it('counts a reconciled bundle once, at its net, in the category of its biggest debit', () => {
    const txs = [
      tx('in-1', 14, 7_250, 'income', 'friend'),
      tx('in-2', 14, 7_250, 'income', 'friend'),
      tx('out-1', 14, -7_246, 'spend', 'tickets'),
      tx('out-2', 14, -7_246, 'spend', 'tickets'),
      tx('out-3', 15, -7_200, 'spend', 'tickets'),
      tx('refund', 17, 7_197, 'spend', 'tickets'),
    ];
    const s = monthlySummary('2026-11', txs, {
      bundles: [{ txIds: txs.map((t) => t.id), netPaise: paise(500) }],
    });
    // net +₹5 (credits 21,697 - debits 21,692): a gain of ₹5, not ₹21,692 of spending
    expect(s.spendPaise).toBe(-500);
    expect(s.incomePaise).toBe(0);
    expect(s.byKind.spend.count).toBe(1);
    expect(s.spendByCategory).toEqual([{ category: 'tickets', spentPaise: -500, fixed: false }]);
  });

  it('dates a bundle at its latest member, even when members straddle two months', () => {
    const txs = [tx('buy', 30, -500, 'spend', 'x', 10), tx('refund', 2, 500, 'spend', 'x', 11)];
    const bundles = [{ txIds: ['buy', 'refund'], netPaise: paise(0) }];
    expect(monthlySummary('2026-10', txs, { bundles }).byKind.spend.count).toBe(0);
    expect(monthlySummary('2026-11', txs, { bundles }).byKind.spend.count).toBe(1);
  });

  it('can exclude suspected duplicates (e.g. an ambiguous pending entry)', () => {
    const txs = [tx('manual', 4, -450, 'spend', 'food'), tx('posted', 4, -450, 'spend', 'food')];
    const s = monthlySummary('2026-11', txs, { excludeIds: new Set(['manual']) });
    expect(s.spendPaise).toBe(45_000);
  });
});

describe('monthlySummary(): exactly-once invariant (property)', () => {
  const arbitraryMonth = fc
    .array(
      fc.record({
        day: fc.integer({ min: 1, max: 30 }),
        rupees: fc.integer({ min: -9_999, max: 9_999 }),
        kind: fc.constantFrom(...TX_KINDS),
        category: fc.constantFrom('food', 'fuel', undefined),
      }),
      { maxLength: 30 },
    )
    .map((rows) => rows.map((r, i) => tx(`t${String(i)}`, r.day, r.rupees, r.kind, r.category)));

  it('every transaction is counted once: kind totals add up to the month total', () => {
    fc.assert(
      fc.property(arbitraryMonth, (txs) => {
        const s = monthlySummary('2026-11', txs);
        const all = TX_KINDS.reduce((sum, k) => sum + s.byKind[k].netPaise, 0);
        expect(all).toBe(txs.reduce((sum, t) => sum + t.amount, 0));
        expect(TX_KINDS.reduce((sum, k) => sum + s.byKind[k].count, 0)).toBe(txs.length);
      }),
    );
  });

  it('bundling never changes the month total, only how it is grouped', () => {
    fc.assert(
      fc.property(arbitraryMonth, (txs) => {
        const purchases = txs.filter((t) => isPurchaseFlow(t.kind));
        const bundles = [];
        for (let i = 0; i + 1 < purchases.length; i += 2) {
          const [a, b] = [purchases[i], purchases[i + 1]];
          if (a === undefined || b === undefined) continue;
          bundles.push({ txIds: [a.id, b.id], netPaise: paise(a.amount + b.amount) });
        }
        const s = monthlySummary('2026-11', txs, { bundles });
        const all = TX_KINDS.reduce((sum, k) => sum + s.byKind[k].netPaise, 0);
        expect(all).toBe(txs.reduce((sum, t) => sum + t.amount, 0));
      }),
    );
  });
});
