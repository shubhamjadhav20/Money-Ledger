import { describe, expect, it } from 'vitest';
import { localDate } from './dates.ts';
import { freeToSpend } from './free-to-spend.ts';
import type { FreeToSpendInput } from './free-to-spend.ts';
import { paise } from './money.ts';

const r = (rupees: number) => paise(rupees * 100);
const today = localDate(2026, 11, 17);
const payday = localDate(2026, 12, 1);

const base: FreeToSpendInput = {
  today,
  nextPayday: payday,
  cardExposure: 'all_outstanding',
  liquidBalances: [
    { accountId: 'bank', balancePaise: r(40_000) },
    { accountId: 'cash', balancePaise: r(2_000) },
  ],
  cards: [],
  pots: [],
  pendingOutflows: [],
  scheduledOutflows: [],
};

const free = (over: Partial<FreeToSpendInput>) => freeToSpend({ ...base, ...over }).freePaise;

describe('freeToSpend()', () => {
  it('is liquid balances when nothing is reserved', () => {
    const result = freeToSpend(base);
    expect(result.freePaise).toBe(r(42_000));
    expect(result.daysToPayday).toBe(14);
    expect(result.lines).toEqual([{ label: 'Bank, savings and cash', amountPaise: r(42_000) }]);
  });

  it('subtracts all card outstanding by default (conservative)', () => {
    const cards = [
      {
        accountId: 'card',
        name: 'DemoCard',
        outstandingPaise: r(9_000),
        dueBeforePaydayPaise: r(4_000),
      },
    ];
    expect(free({ cards })).toBe(r(33_000));
    expect(free({ cards, cardExposure: 'due_before_payday' })).toBe(r(38_000));
  });

  it('reserves buffer and due-before-payday bill pots up to their target (shortfall included)', () => {
    const pots = [
      {
        pot: { id: 'buf', name: 'Buffer', kind: 'buffer' as const, targetPaise: r(10_000) },
        balancePaise: r(6_000),
      },
      {
        pot: {
          id: 'rent',
          name: 'Rent',
          kind: 'bill' as const,
          targetPaise: r(18_000),
          dueDate: localDate(2026, 11, 30),
        },
        balancePaise: r(18_000),
      },
    ];
    expect(free({ pots })).toBe(r(42_000 - 10_000 - 18_000));
  });

  it('reserves only the balance of a bill pot due after payday, and nothing for spend pots', () => {
    const pots = [
      {
        pot: {
          id: 'ins',
          name: 'Insurance',
          kind: 'bill' as const,
          targetPaise: r(20_000),
          dueDate: localDate(2027, 1, 15),
        },
        balancePaise: r(5_000),
      },
      { pot: { id: 'fun', name: 'Fun', kind: 'spend' as const }, balancePaise: r(3_000) },
    ];
    expect(free({ pots })).toBe(r(37_000));
  });

  it('never double-counts a card-bill pot and the card it covers', () => {
    const cards = [
      {
        accountId: 'card',
        name: 'DemoCard',
        outstandingPaise: r(9_000),
        dueBeforePaydayPaise: r(9_000),
      },
    ];
    const cardPot = (balance: number) => [
      {
        pot: { id: 'cc', name: 'Card bill', kind: 'bill' as const, coversCardAccountId: 'card' },
        balancePaise: r(balance),
      },
    ];
    expect(free({ cards, pots: cardPot(12_000) })).toBe(r(30_000)); // pot covers more than owed
    expect(free({ cards, pots: cardPot(5_000) })).toBe(r(33_000)); // owed is more than the pot
  });

  it('subtracts pending outflows and scheduled outflows up to payday only', () => {
    const result = freeToSpend({
      ...base,
      pendingOutflows: [
        { id: 'm1', amountPaise: r(-250) },
        { id: 'm2', amountPaise: r(-50) },
      ],
      scheduledOutflows: [
        { label: 'Slice in 3: 1 of 3', date: localDate(2026, 11, 25), amountPaise: r(800) },
        { label: 'Slice in 3: 2 of 3', date: localDate(2026, 12, 25), amountPaise: r(800) },
      ],
    });
    expect(result.freePaise).toBe(r(42_000 - 300 - 800));
    expect(result.lines.map((l) => l.label)).toEqual([
      'Bank, savings and cash',
      'Pending entries not yet on a statement',
      'Slice in 3: 1 of 3 (25 Nov)',
    ]);
  });

  it('can be negative, and says so', () => {
    const cards = [
      {
        accountId: 'card',
        name: 'DemoCard',
        outstandingPaise: r(50_000),
        dueBeforePaydayPaise: r(50_000),
      },
    ];
    expect(free({ cards })).toBe(r(-8_000));
  });

  it('itemises every deduction so the number can be explained', () => {
    const result = freeToSpend({
      ...base,
      cards: [
        {
          accountId: 'card',
          name: 'DemoCard',
          outstandingPaise: r(1_000),
          dueBeforePaydayPaise: r(0),
        },
      ],
      pots: [
        {
          pot: { id: 'buf', name: 'Buffer', kind: 'buffer' as const, targetPaise: r(500) },
          balancePaise: r(500),
        },
      ],
    });
    const total = result.lines.reduce((s, l) => s + l.amountPaise, 0);
    expect(total).toBe(result.freePaise);
    expect(result.lines.map((l) => l.label)).toEqual([
      'Bank, savings and cash',
      'DemoCard owed',
      'Buffer pot',
    ]);
  });
});
