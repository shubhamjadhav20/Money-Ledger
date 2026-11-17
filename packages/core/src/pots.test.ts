import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { localDate } from './dates.ts';
import { paise } from './money.ts';
import { applyPayday } from './payday.ts';
import { paydayMovements, potBalances, trueUpMovement } from './pots.ts';
import type { Pot, PotMovement } from './pots.ts';

const day = localDate(2026, 11, 1);
const pots: Pot[] = [
  { id: 'buffer', name: 'Buffer', kind: 'buffer', targetPaise: paise(5_000_000) },
  {
    id: 'rent',
    name: 'Rent',
    kind: 'bill',
    targetPaise: paise(1_800_000),
    dueDate: localDate(2026, 11, 5),
  },
  { id: 'fun', name: 'Fun', kind: 'spend' },
];

const move = (
  potId: string,
  amount: number,
  reason: PotMovement['reason'] = 'manual',
): PotMovement => ({
  id: `${potId}-${String(amount)}`,
  potId,
  amountPaise: paise(amount),
  reason,
  date: day,
});

describe('potBalances()', () => {
  it('derives balances from the journal; pots with no movements are zero', () => {
    const balances = potBalances(pots, [
      move('buffer', 100_000),
      move('buffer', -30_000),
      move('rent', 1_800_000),
    ]);
    expect(Object.fromEntries(balances)).toEqual({ buffer: 70_000, rent: 1_800_000, fun: 0 });
  });

  it('rejects movements for unknown pots', () => {
    expect(() => potBalances(pots, [move('nope', 1)])).toThrow(/unknown pot/i);
  });

  it('balance equals the sum of movements, whatever their order', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { maxLength: 30 }),
        (amounts) => {
          const movements = amounts.map((a, i) => ({ ...move('fun', a), id: String(i) }));
          const forward = potBalances(pots, movements).get('fun');
          const backward = potBalances(pots, [...movements].reverse()).get('fun');
          expect(forward).toBe(amounts.reduce((s, a) => s + a, 0));
          expect(backward).toBe(forward);
        },
      ),
    );
  });
});

describe('paydayMovements()', () => {
  it('turns pot allocations into journal entries with stable ids', () => {
    const result = applyPayday(paise(1_000_000), [
      { name: 'Rent', kind: 'fixed', amountPaise: 600_000, potId: 'rent' },
      { name: 'Family', kind: 'fixed', amountPaise: 100_000 }, // no pot: not a movement
      { name: 'Buffer', kind: 'fixed', amountPaise: 0, potId: 'buffer' }, // zero: skipped
      { name: 'Fun', kind: 'remainder', potId: 'fun' },
    ]);
    expect(paydayMovements(result, day, 'payday-2026-11')).toEqual([
      {
        id: 'payday-2026-11:0',
        potId: 'rent',
        amountPaise: 600_000,
        reason: 'payday',
        date: day,
        paydayRunId: 'payday-2026-11',
      },
      {
        id: 'payday-2026-11:3',
        potId: 'fun',
        amountPaise: 300_000,
        reason: 'payday',
        date: day,
        paydayRunId: 'payday-2026-11',
      },
    ]);
  });
});

describe('trueUpMovement()', () => {
  it('posts the gap as an adjusting entry, never an edit', () => {
    expect(trueUpMovement('buffer', paise(70_000), paise(65_000), day, 'tu-1')).toEqual({
      id: 'tu-1',
      potId: 'buffer',
      amountPaise: -5000,
      reason: 'trueup',
      date: day,
    });
    expect(trueUpMovement('buffer', paise(70_000), paise(70_000), day, 'tu-2')).toBeUndefined();
  });
});
