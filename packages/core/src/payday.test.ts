import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { paise, sumPaise } from './money.ts';
import { PaydayError, applyPayday, validatePaydayRules } from './payday.ts';
import type { PaydayRule } from './payday.ts';

const rupees = (r: number) => paise(r * 100);

describe('applyPayday(): the monthly waterfall', () => {
  const rules: PaydayRule[] = [
    { name: 'SIP', kind: 'fixed', amountPaise: rupees(10_000), potId: 'sip' },
    { name: 'Family', kind: 'fixed', amountPaise: rupees(15_000) },
    { name: 'Card bill', kind: 'fixed', amountPaise: rupees(12_345), potId: 'card' },
    { name: 'Buffer', kind: 'percent', basisPoints: 1000, potId: 'buffer' }, // 10% of gross
    { name: 'Spending', kind: 'remainder', potId: 'spend' },
  ];

  it('allocates in order and gives the remainder everything left', () => {
    const { allocations, unallocatedPaise } = applyPayday(rupees(85_000), rules);
    expect(allocations.map((a) => [a.name, a.allocatedPaise])).toEqual([
      ['SIP', 1_000_000],
      ['Family', 1_500_000],
      ['Card bill', 1_234_500],
      ['Buffer', 850_000],
      ['Spending', 3_915_500],
    ]);
    expect(unallocatedPaise).toBe(0);
    expect(allocations.every((a) => a.shortfallPaise === 0)).toBe(true);
  });

  it('reports shortfalls when the salary does not cover the rules', () => {
    const { allocations, unallocatedPaise } = applyPayday(rupees(30_000), rules);
    expect(allocations.map((a) => [a.name, a.allocatedPaise, a.shortfallPaise])).toEqual([
      ['SIP', 1_000_000, 0],
      ['Family', 1_500_000, 0],
      ['Card bill', 500_000, 734_500],
      ['Buffer', 0, 300_000],
      ['Spending', 0, 0],
    ]);
    expect(unallocatedPaise).toBe(0);
  });

  it('keeps unallocated money visible when there is no remainder rule', () => {
    const { unallocatedPaise } = applyPayday(rupees(1000), [
      { name: 'Rent', kind: 'fixed', amountPaise: rupees(400) },
    ]);
    expect(unallocatedPaise).toBe(60_000);
  });

  it('rounds percentages by largest remainder so shares add up exactly', () => {
    const halves: PaydayRule[] = [
      { name: 'A', kind: 'percent', basisPoints: 5000 },
      { name: 'B', kind: 'percent', basisPoints: 5000 },
    ];
    // 101 paise split 50/50: 50.5 each -> 51 + 50 (tie goes to the earlier rule).
    const { allocations, unallocatedPaise } = applyPayday(paise(101), halves);
    expect(allocations.map((a) => a.allocatedPaise)).toEqual([51, 50]);
    expect(unallocatedPaise).toBe(0);

    const thirds: PaydayRule[] = [
      { name: 'A', kind: 'percent', basisPoints: 3333 },
      { name: 'B', kind: 'percent', basisPoints: 3334 },
      { name: 'C', kind: 'percent', basisPoints: 3333 },
    ];
    expect(applyPayday(rupees(100), thirds).allocations.map((a) => a.allocatedPaise)).toEqual([
      3333, 3334, 3333,
    ]);
  });

  it('handles a zero payday', () => {
    const { allocations, unallocatedPaise } = applyPayday(paise(0), rules);
    expect(allocations.every((a) => a.allocatedPaise === 0)).toBe(true);
    expect(unallocatedPaise).toBe(0);
  });
});

describe('validatePaydayRules()', () => {
  it.each<[string, PaydayRule[]]>([
    ['negative fixed', [{ name: 'x', kind: 'fixed', amountPaise: -1 }]],
    ['fractional fixed', [{ name: 'x', kind: 'fixed', amountPaise: 1.5 }]],
    ['percent over 100%', [{ name: 'x', kind: 'percent', basisPoints: 10_001 }]],
    [
      'percents summing over 100%',
      [
        { name: 'a', kind: 'percent', basisPoints: 6000 },
        { name: 'b', kind: 'percent', basisPoints: 5000 },
      ],
    ],
    [
      'two remainders',
      [
        { name: 'a', kind: 'remainder' },
        { name: 'b', kind: 'remainder' },
      ],
    ],
    [
      'remainder not last',
      [
        { name: 'a', kind: 'remainder' },
        { name: 'b', kind: 'fixed', amountPaise: 1 },
      ],
    ],
  ])('rejects %s', (_label, bad) => {
    expect(validatePaydayRules(bad)).not.toEqual([]);
    expect(() => applyPayday(paise(100), bad)).toThrow(PaydayError);
  });

  it('rejects a negative payday amount', () => {
    expect(() => applyPayday(paise(-1), [])).toThrow(PaydayError);
  });
});

describe('applyPayday(): properties', () => {
  const rule = fc.oneof(
    fc.record({
      name: fc.constant('f'),
      kind: fc.constant('fixed' as const),
      amountPaise: fc.integer({ min: 0, max: 10_000_000 }),
    }),
    fc.record({
      name: fc.constant('p'),
      kind: fc.constant('percent' as const),
      basisPoints: fc.integer({ min: 0, max: 2500 }),
    }),
  );
  const ruleSets = fc
    .tuple(fc.array(rule, { maxLength: 4 }), fc.boolean())
    .map(([rs, withRemainder]): PaydayRule[] =>
      withRemainder ? [...rs, { name: 'r', kind: 'remainder' }] : rs,
    );
  const amount = fc.integer({ min: 0, max: 100_000_000_00 });

  it('allocations plus unallocated always equal the payday amount exactly', () => {
    fc.assert(
      fc.property(amount, ruleSets, (a, rs) => {
        const { allocations, unallocatedPaise } = applyPayday(paise(a), rs);
        expect(sumPaise(allocations.map((x) => x.allocatedPaise)) + unallocatedPaise).toBe(a);
      }),
    );
  });

  it('every allocation is between 0 and what was requested, and shortfall is the gap', () => {
    fc.assert(
      fc.property(amount, ruleSets, (a, rs) => {
        for (const x of applyPayday(paise(a), rs).allocations) {
          expect(x.allocatedPaise).toBeGreaterThanOrEqual(0);
          expect(x.allocatedPaise + x.shortfallPaise).toBe(x.requestedPaise);
        }
      }),
    );
  });

  it('percent rules that add up to 100% use every paisa', () => {
    fc.assert(
      fc.property(amount, fc.integer({ min: 0, max: 10_000 }), (a, split) => {
        const { allocations, unallocatedPaise } = applyPayday(paise(a), [
          { name: 'a', kind: 'percent', basisPoints: split },
          { name: 'b', kind: 'percent', basisPoints: 10_000 - split },
        ]);
        expect(unallocatedPaise).toBe(0);
        expect(sumPaise(allocations.map((x) => x.allocatedPaise))).toBe(a);
      }),
    );
  });
});
