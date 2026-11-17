import { describe, expect, it } from 'vitest';
import {
  amountDueFor,
  dueDateFor,
  nextDueDate,
  nextMonthlyDate,
  nextPayday,
  nextStatementDate,
  statementDateFor,
  statementPeriod,
} from './cycle.ts';
import type { CardCycle } from './cycle.ts';
import { localDate } from './dates.ts';
import type { LocalDate } from './dates.ts';
import { paise } from './money.ts';

const d = (s: string): LocalDate => {
  const [y, m, day] = s.split('-').map(Number) as [number, number, number];
  return localDate(y, m, day);
};

describe('nextMonthlyDate()', () => {
  it.each([
    ['2026-11-03', 5, true, '2026-11-05'],
    ['2026-11-05', 5, true, '2026-11-05'],
    ['2026-11-05', 5, false, '2026-12-05'],
    ['2026-11-06', 5, true, '2026-12-05'],
    ['2026-12-20', 5, true, '2027-01-05'],
    // Month-end clamping.
    ['2027-02-01', 31, true, '2027-02-28'],
    ['2028-02-01', 31, true, '2028-02-29'],
    ['2026-04-15', 31, true, '2026-04-30'],
    ['2026-04-30', 31, false, '2026-05-31'],
  ] as const)('from %s, day %d (inclusive %s) -> %s', (from, day, inclusive, expected) => {
    expect(nextMonthlyDate(d(from), day, inclusive)).toBe(expected);
  });

  it('rejects days outside 1..31', () => {
    expect(() => nextMonthlyDate(d('2026-11-01'), 0)).toThrow();
    expect(() => nextMonthlyDate(d('2026-11-01'), 32)).toThrow();
  });
});

describe('card statement cycle', () => {
  const cycle: CardCycle = { statementDay: 20, dueDay: 10 };

  it('a purchase lands on the next statement (statement day itself included)', () => {
    expect(statementDateFor(d('2026-11-20'), cycle)).toBe('2026-11-20');
    expect(statementDateFor(d('2026-11-21'), cycle)).toBe('2026-12-20');
  });

  it('the due date follows its statement, crossing the month when needed', () => {
    expect(dueDateFor(d('2026-11-20'), cycle)).toBe('2026-12-10');
    expect(dueDateFor(d('2026-11-05'), { statementDay: 5, dueDay: 25 })).toBe('2026-11-25');
  });

  it('finds the next statement and due date from today', () => {
    expect(nextStatementDate(d('2026-11-17'), cycle)).toBe('2026-11-20');
    expect(nextDueDate(d('2026-11-17'), cycle)).toBe('2026-12-10');
    expect(nextDueDate(d('2026-12-10'), cycle)).toBe('2026-12-10');
  });

  it('statement period runs from the day after the previous statement', () => {
    expect(statementPeriod(d('2026-11-20'), cycle)).toEqual({
      from: '2026-10-21',
      to: '2026-11-20',
    });
    expect(statementPeriod(d('2027-03-31'), { statementDay: 31, dueDay: 20 })).toEqual({
      from: '2027-03-01',
      to: '2027-03-31',
    });
  });

  it('amount due is what the period owes: purchases minus refunds/payments in it, never negative', () => {
    const txs = [
      { date: d('2026-10-20'), amount: paise(-50_000) }, // previous statement
      { date: d('2026-10-21'), amount: paise(-10_000) },
      { date: d('2026-11-20'), amount: paise(-5_000) }, // statement day: included
      { date: d('2026-11-01'), amount: paise(2_000) }, // refund
      { date: d('2026-11-21'), amount: paise(-99_999) }, // next statement
    ];
    expect(amountDueFor(d('2026-11-20'), cycle, txs)).toBe(13_000);
    expect(
      amountDueFor(d('2026-11-20'), cycle, [{ date: d('2026-11-01'), amount: paise(500) }]),
    ).toBe(0);
  });
});

describe('nextPayday()', () => {
  it('is strictly after today', () => {
    expect(nextPayday(d('2026-11-17'), { day: 1 })).toBe('2026-12-01');
    expect(nextPayday(d('2026-12-01'), { day: 1 })).toBe('2027-01-01');
    expect(nextPayday(d('2026-11-30'), { day: 31 })).toBe('2026-12-31');
  });

  it('can move a weekend payday back to Friday', () => {
    // 1 Nov 2026 is a Sunday; 1 Aug 2026 is a Saturday.
    expect(nextPayday(d('2026-10-15'), { day: 1, weekend: 'previous-weekday' })).toBe('2026-10-30');
    expect(nextPayday(d('2026-07-15'), { day: 1, weekend: 'previous-weekday' })).toBe('2026-07-31');
    expect(nextPayday(d('2026-10-15'), { day: 1 })).toBe('2026-11-01');
  });

  it('skips a shifted payday that is not after today', () => {
    // Shifted payday for 1 Nov is Fri 30 Oct; on 30 Oct the next one is 1 Dec (a Tuesday).
    expect(nextPayday(d('2026-10-30'), { day: 1, weekend: 'previous-weekday' })).toBe('2026-12-01');
  });
});
