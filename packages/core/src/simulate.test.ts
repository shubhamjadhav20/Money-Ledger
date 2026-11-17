import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { localDate } from './dates.ts';
import { paise, sumPaise } from './money.ts';
import { SLICE_IN_3, simulatePurchase, splitInstallments } from './simulate.ts';
import type { InstallmentPreset, SimulateContext } from './simulate.ts';

const r = (rupees: number) => paise(rupees * 100);
const today = localDate(2026, 11, 17);

const ctx = (over: Partial<SimulateContext> = {}): SimulateContext => ({
  today,
  freePaise: r(10_000),
  nextPayday: localDate(2026, 12, 1),
  cardExposure: 'all_outstanding',
  card: { name: 'DemoCard', cycle: { statementDay: 20, dueDay: 10 } },
  presets: [SLICE_IN_3],
  ...over,
});

describe('simulatePurchase(): UPI', () => {
  it('comes straight off free-to-spend', () => {
    expect(simulatePurchase(r(2_300), 'upi', ctx())).toEqual({
      method: 'upi',
      affordableNow: true,
      freeAfterPaise: r(7_700),
      installments: [],
      cardCharge: undefined,
      warnings: [],
    });
  });

  it('warns when it would push free-to-spend below zero', () => {
    const result = simulatePurchase(r(12_000), 'upi', ctx());
    expect(result.affordableNow).toBe(false);
    expect(result.freeAfterPaise).toBe(r(-2_000));
    expect(result.warnings).toEqual(['Leaves you ₹2,000.00 short until payday (1 Dec).']);
  });
});

describe('simulatePurchase(): card', () => {
  it('lands on the next statement and, by default, reduces free-to-spend now', () => {
    const result = simulatePurchase(r(2_300), 'card', ctx());
    expect(result.cardCharge).toEqual({
      statementDate: '2026-11-20',
      dueDate: '2026-12-10',
      amountPaise: r(2_300),
    });
    expect(result.freeAfterPaise).toBe(r(7_700));
  });

  it('with due_before_payday exposure, a bill due after payday leaves free-to-spend unchanged now', () => {
    const result = simulatePurchase(r(2_300), 'card', ctx({ cardExposure: 'due_before_payday' }));
    expect(result.freeAfterPaise).toBe(r(10_000));
    expect(result.warnings).toEqual(['₹2,300.00 is due on 10 Dec, after payday (1 Dec).']);
  });

  it('needs a card', () => {
    const noCard = { ...ctx() };
    delete (noCard as { card?: unknown }).card;
    expect(() => simulatePurchase(r(1), 'card', noCard)).toThrow(/card/i);
  });
});

describe('simulatePurchase(): Slice in 3 (installment preset)', () => {
  it('splits into 3 installments on the next 3 statements; only those due by payday count now', () => {
    const result = simulatePurchase(
      r(2_300),
      'slice_in_3',
      ctx({ nextPayday: localDate(2026, 12, 15) }),
    );
    expect(result.installments).toEqual([
      { number: 1, statementDate: '2026-11-20', dueDate: '2026-12-10', amountPaise: 76_667 },
      { number: 2, statementDate: '2026-12-20', dueDate: '2027-01-10', amountPaise: 76_667 },
      { number: 3, statementDate: '2027-01-20', dueDate: '2027-02-10', amountPaise: 76_666 },
    ]);
    expect(result.freeAfterPaise).toBe(r(10_000) - 76_667);
    expect(result.affordableNow).toBe(true);
    expect(result.warnings).toEqual(['2 more installments (₹1,533.33) fall after payday.']);
  });

  it('adds a configured fee to the first installment and says so', () => {
    const withFee: InstallmentPreset = { ...SLICE_IN_3, fee: { kind: 'flat', paise: r(49) } };
    const result = simulatePurchase(r(300), 'slice_in_3', ctx({ presets: [withFee] }));
    expect(result.installments.map((i) => i.amountPaise)).toEqual([14_900, 10_000, 10_000]);
    expect(result.warnings).toContain('Fee: ₹49.00.');
  });

  it('supports a basis-point fee', () => {
    const withFee: InstallmentPreset = { ...SLICE_IN_3, fee: { kind: 'bps', basisPoints: 100 } };
    const result = simulatePurchase(r(3_000), 'slice_in_3', ctx({ presets: [withFee] }));
    expect(sumPaise(result.installments.map((i) => i.amountPaise))).toBe(r(3_030));
  });

  it('refuses amounts below the preset minimum', () => {
    const min: InstallmentPreset = { ...SLICE_IN_3, minPrincipalPaise: r(500) };
    const result = simulatePurchase(r(499), 'slice_in_3', ctx({ presets: [min] }));
    expect(result.affordableNow).toBe(false);
    expect(result.installments).toEqual([]);
    expect(result.freeAfterPaise).toBe(r(10_000));
    expect(result.warnings).toEqual(['Slice in 3 needs at least ₹500.00.']);
  });

  it('rejects unknown methods and non-positive amounts', () => {
    expect(() => simulatePurchase(r(1), 'paylater_9', ctx())).toThrow(/unknown/i);
    expect(() => simulatePurchase(paise(0), 'upi', ctx())).toThrow(/positive/i);
  });
});

describe('splitInstallments()', () => {
  it('always sums to the total and differs by at most one paisa', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000_000 }),
        fc.integer({ min: 1, max: 24 }),
        (total, n) => {
          const parts = splitInstallments(paise(total), n);
          expect(parts).toHaveLength(n);
          expect(sumPaise(parts)).toBe(total);
          expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
