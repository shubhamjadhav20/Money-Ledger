import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { localDate } from './dates.ts';
import { paise, sumPaise } from './money.ts';
import { DEFAULT_RECONCILE_OPTIONS, counterpartySimilarity, reconcile } from './reconcile.ts';
import type { ReconcileOptions, ReconcileTx } from './reconcile.ts';

const tx = (
  id: string,
  day: number,
  rupees: number,
  counterparty: string,
  extra: Partial<ReconcileTx> = {},
): ReconcileTx => ({
  id,
  accountId: 'bank',
  date: localDate(2026, 10, day),
  amount: paise(Math.round(rupees * 100)),
  counterparty,
  ...extra,
});

const opts = (over: Partial<ReconcileOptions> = {}): ReconcileOptions => ({
  ...DEFAULT_RECONCILE_OPTIONS,
  ...over,
});

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe('reconcile(): golden test from real life (PLAN.md rule 3)', () => {
  // 2 friends pay me ₹7,250 each; I buy 2 tickets at ₹7,246; I pay a friend ₹7,200;
  // the merchant refunds ₹7,197. Real net: +₹5, not ₹21,692 of "spending".
  const golden = [
    tx('in-alpha', 14, 7250, 'UPI/FRIEND ALPHA/TICKETS'),
    tx('in-beta', 14, 7250, 'UPI/FRIEND BETA/TICKETS'),
    tx('out-shop-1', 14, -7246, 'UPI/EVENT TICKETS CO'),
    tx('out-shop-2', 14, -7246, 'UPI/EVENT TICKETS CO'),
    tx('out-gamma', 15, -7200, 'UPI/FRIEND GAMMA/TICKETS'),
    tx('in-refund', 17, 7197, 'UPI/EVENT TICKETS CO/REFUND'),
  ];

  const result = reconcile(golden);

  it('nets to +₹5 across bundles, with nothing left over', () => {
    expect(sumPaise(result.bundles.map((b) => b.netPaise))).toBe(500);
    expect(result.unmatched).toEqual([]);
    expect(result.singles).toEqual([]);
  });

  it('groups the interchangeable 2 x 7,250 / 2 x 7,246 as one bundle and the friend/refund as a pair', () => {
    const groups = result.bundles.map((b) => sorted(b.txIds)).sort((a, b) => a.length - b.length);
    expect(groups).toEqual([
      ['in-refund', 'out-gamma'],
      ['in-alpha', 'in-beta', 'out-shop-1', 'out-shop-2'],
    ]);
    const nets = result.bundles.map((b) => b.netPaise).sort((a, b) => a - b);
    expect(nets).toEqual([-300, 800]);
  });

  it('leaves both bundles open for confirmation (different counterparties)', () => {
    expect(result.bundles.map((b) => b.status)).toEqual(['open', 'open']);
  });
});

describe('reconcile(): pairs and status', () => {
  it('auto-settles a purchase and its refund from the same merchant', () => {
    const { bundles, singles } = reconcile([
      tx('buy', 1, -999, 'UPI/BOOKSTORE TWO/123'),
      tx('refund', 4, 999, 'BOOKSTORE TWO REFUND 456'),
      tx('lunch', 2, -250, 'UPI/BAKERY THREE'),
    ]);
    expect(bundles).toMatchObject([{ txIds: ['buy', 'refund'], netPaise: 0, status: 'settled' }]);
    expect(singles).toEqual(['lunch']);
  });

  it('does not silently settle a coincidental equal amount from someone else', () => {
    const { bundles } = reconcile([
      tx('a', 3, -500, 'GROCER ONE'),
      tx('b', 3, 500, 'FRIEND DELTA'),
    ]);
    expect(bundles).toMatchObject([{ status: 'open' }]);
  });

  it('leaves transfers out entirely and never pairs zero amounts', () => {
    const { bundles, singles } = reconcile([
      tx('cc', 1, -5000, 'NEFT CC PAYMENT', { kind: 'transfer' }),
      tx('back', 1, 5000, 'NEFT CC PAYMENT'),
      tx('zero', 1, 0, 'FEE REVERSAL'),
    ]);
    expect(bundles).toEqual([]);
    expect(sorted(singles)).toEqual(['back', 'zero']);
  });
});

describe('reconcile(): tolerance', () => {
  it('matches within the absolute tolerance (fees) and not beyond it', () => {
    const within = reconcile([tx('d', 1, -1000, 'SHOP'), tx('c', 1, 990, 'SHOP')], opts());
    expect(within.bundles).toMatchObject([{ netPaise: -1000 }]);

    const beyond = reconcile([tx('d', 1, -1000, 'SHOP'), tx('c', 1, 989.99, 'SHOP')], opts());
    expect(beyond.bundles).toEqual([]);
  });

  it('supports a percentage tolerance in basis points for larger amounts', () => {
    const txs = [tx('d', 1, -50_000, 'HOTEL'), tx('c', 2, 49_600, 'HOTEL')]; // ₹400 apart
    expect(reconcile(txs, opts()).bundles).toEqual([]);
    const onePercent = opts({ tolerance: { absPaise: 1000, basisPoints: 100 } });
    expect(reconcile(txs, onePercent).bundles).toMatchObject([{ netPaise: -40_000 }]);
  });
});

describe('reconcile(): date window', () => {
  it('matches inside the window in either order, not outside it', () => {
    const w = opts({ windowDays: 3 });
    expect(reconcile([tx('d', 10, -100, 'S'), tx('c', 13, 100, 'S')], w).bundles).toHaveLength(1);
    expect(reconcile([tx('c', 7, 100, 'S'), tx('d', 10, -100, 'S')], w).bundles).toHaveLength(1);
    expect(reconcile([tx('d', 10, -100, 'S'), tx('c', 14, 100, 'S')], w).bundles).toEqual([]);
  });
});

describe('reconcile(): ambiguity is never guessed', () => {
  it('one debit with two equal candidate credits goes to review', () => {
    const { bundles, unmatched } = reconcile([
      tx('d', 5, -300, 'SHOP'),
      tx('c1', 5, 300, 'SHOP'),
      tx('c2', 6, 300, 'SHOP'),
    ]);
    expect(bundles).toEqual([]);
    // Review queue is ordered by date, then id.
    expect(unmatched.map((u) => [u.txId, u.reason])).toEqual([
      ['c1', 'ambiguous'],
      ['d', 'ambiguous'],
      ['c2', 'ambiguous'],
    ]);
    const debit = unmatched.find((u) => u.txId === 'd');
    expect(sorted(debit?.relatedTxIds ?? [])).toEqual(['c1', 'c2']);
  });

  it('splits a group into pairs when only one complete pairing exists', () => {
    // Tolerance ₹10. d1 (-100) could take c1 (+100) or c2 (+109); d2 (-118) can only take c2
    // (c1 is ₹18 away), so the only complete pairing is d1-c1, d2-c2.
    const { bundles, unmatched } = reconcile([
      tx('d1', 1, -100, 'A'),
      tx('d2', 1, -118, 'B'),
      tx('c1', 1, 100, 'A'),
      tx('c2', 1, 109, 'B'),
    ]);
    expect(unmatched).toEqual([]);
    expect(bundles.map((b) => sorted(b.txIds))).toEqual([
      ['c1', 'd1'],
      ['c2', 'd2'],
    ]);
  });

  it('sends oversized groups to review instead of searching forever', () => {
    const many = Array.from({ length: 9 }, (_, i) => [
      tx(`d${String(i)}`, 1, -100, 'X'),
      tx(`c${String(i)}`, 1, 100, 'X'),
    ]).flat();
    const { bundles, unmatched } = reconcile(many);
    expect(bundles).toEqual([]);
    expect(new Set(unmatched.map((u) => u.reason))).toEqual(new Set(['group-too-large']));
    expect(unmatched).toHaveLength(18);
  });
});

describe('reconcile(): determinism', () => {
  it('gives the same output regardless of input order', () => {
    const txs = [
      tx('a', 1, -100, 'SHOP'),
      tx('b', 2, 100, 'SHOP REFUND'),
      tx('c', 3, -50, 'CAFE'),
      tx('d', 3, 7250, 'FRIEND'),
      tx('e', 3, -7246, 'MERCHANT'),
    ];
    expect(reconcile([...txs].reverse())).toEqual(reconcile(txs));
  });
});

describe('counterpartySimilarity()', () => {
  it('ignores payment-rail noise words and reference numbers', () => {
    expect(counterpartySimilarity('UPI/BOOKSTORE TWO/123', 'BOOKSTORE TWO REFUND 456')).toBe(1);
  });

  it('is 0 for unrelated parties and when nothing meaningful is left', () => {
    expect(counterpartySimilarity('GROCER ONE', 'FRIEND DELTA')).toBe(0);
    expect(counterpartySimilarity('UPI/123', 'NEFT')).toBe(0);
  });
});

describe('reconcile(): properties', () => {
  const arbitraryTxs = fc
    .array(
      fc.record({
        day: fc.integer({ min: 1, max: 28 }),
        // Few distinct amounts so random sets actually produce links and ambiguity.
        amount: fc.constantFrom(-7250, -7246, -500, -499, 500, 7197, 7250, 0),
        who: fc.constantFrom('SHOP', 'SHOP REFUND', 'FRIEND', 'CAFE'),
        transfer: fc.boolean(),
      }),
      { maxLength: 24 },
    )
    .map((rows) =>
      rows.map((row, i) =>
        tx(
          `t${String(i)}`,
          row.day,
          row.amount,
          row.who,
          row.transfer && i % 5 === 0 ? { kind: 'transfer' } : {},
        ),
      ),
    );

  it('every non-transfer transaction lands in exactly one place (exactly-once invariant)', () => {
    fc.assert(
      fc.property(arbitraryTxs, (txs) => {
        const { bundles, unmatched, singles } = reconcile(txs);
        const placed = [
          ...bundles.flatMap((b) => b.txIds),
          ...unmatched.map((u) => u.txId),
          ...singles,
        ];
        const expected = txs.filter((t) => t.kind !== 'transfer').map((t) => t.id);
        expect(sorted(placed)).toEqual(sorted(expected));
      }),
    );
  });

  it('money is conserved: bundle nets + leftovers equal the original total', () => {
    fc.assert(
      fc.property(arbitraryTxs, (txs) => {
        const { bundles, unmatched, singles } = reconcile(txs);
        const amountOf = new Map(txs.map((t) => [t.id, t.amount]));
        const leftovers = [...unmatched.map((u) => u.txId), ...singles].map(
          (id) => amountOf.get(id) ?? paise(0),
        );
        const total = sumPaise(txs.filter((t) => t.kind !== 'transfer').map((t) => t.amount));
        expect(sumPaise([...bundles.map((b) => b.netPaise), ...leftovers])).toBe(total);
      }),
    );
  });
});
