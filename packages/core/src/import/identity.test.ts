import { describe, expect, it } from 'vitest';
import { localDate } from '../dates.ts';
import { paise } from '../money.ts';
import { identityBase, normaliseCounterparty, planImport, withOccurrences } from './identity.ts';
import type { RawRow } from './types.ts';

const row = (over: Partial<RawRow> = {}): RawRow => ({
  line: 1,
  date: localDate(2026, 11, 1),
  amount: paise(-2000),
  counterparty: 'CHAI POINT',
  memo: '',
  ...over,
});

describe('normaliseCounterparty()', () => {
  it('ignores case, punctuation and spacing differences between exports', () => {
    expect(normaliseCounterparty('  upi/Chai-Point  /123 ')).toBe('UPI CHAI POINT 123');
    expect(normaliseCounterparty('UPI CHAI POINT 123')).toBe('UPI CHAI POINT 123');
  });

  it('folds full-width and compatibility characters', () => {
    expect(normaliseCounterparty('ＣＨＡＩ')).toBe('CHAI');
  });
});

describe('identityBase()', () => {
  it('uses the bank ref when present, so reformatted narration still dedupes', () => {
    const a = identityBase('acc1', row({ ref: 'R1', counterparty: 'UPI/CHAI/1' }));
    const b = identityBase('acc1', row({ ref: 'R1', counterparty: 'upi chai 1 (new format)' }));
    expect(a).toBe(b);
  });

  it('uses the normalised counterparty when there is no ref', () => {
    expect(identityBase('acc1', row({ counterparty: 'Chai Point' }))).toBe(
      identityBase('acc1', row({ counterparty: 'CHAI-POINT' })),
    );
  });

  it('differs by account, date, amount and counterparty', () => {
    const base = identityBase('acc1', row());
    expect(identityBase('acc2', row())).not.toBe(base);
    expect(identityBase('acc1', row({ date: localDate(2026, 11, 2) }))).not.toBe(base);
    expect(identityBase('acc1', row({ amount: paise(-2001) }))).not.toBe(base);
    expect(identityBase('acc1', row({ counterparty: 'OTHER' }))).not.toBe(base);
  });

  it('does not depend on line number or memo', () => {
    expect(identityBase('acc1', row({ line: 99, memo: 'x' }))).toBe(identityBase('acc1', row()));
  });
});

describe('withOccurrences()', () => {
  it('numbers identical rows within one statement 1, 2, 3...', () => {
    const keyed = withOccurrences('acc1', [
      row({ line: 1 }),
      row({ line: 2 }),
      row({ counterparty: 'X', line: 3 }),
    ]);
    expect(keyed.map((k) => k.occurrence)).toEqual([1, 2, 1]);
    expect(keyed[0]?.identity).not.toBe(keyed[1]?.identity);
  });
});

describe('planImport()', () => {
  it('keeps two real identical same-day purchases (2 x ₹20 chai) as two rows', () => {
    const { fresh, duplicates } = planImport(
      'acc1',
      [row({ line: 1 }), row({ line: 2 })],
      new Set(),
    );
    expect(fresh).toHaveLength(2);
    expect(duplicates).toEqual([]);
  });

  it('re-importing the same statement creates 0 new rows', () => {
    const statement = [
      row({ line: 1 }),
      row({ line: 2 }),
      row({ counterparty: 'RENT', amount: paise(-1_500_000) }),
    ];
    const first = planImport('acc1', statement, new Set());
    const existing = new Set(first.fresh.map((k) => k.identity));

    const second = planImport('acc1', statement, existing);
    expect(second.fresh).toEqual([]);
    expect(second.duplicates).toHaveLength(3);
  });

  it('an overlapping later statement only adds the new rows', () => {
    const october = [row({ line: 1 }), row({ line: 2 })];
    const existing = new Set(planImport('acc1', october, new Set()).fresh.map((k) => k.identity));

    const overlapping = [
      row({ line: 1 }),
      row({ line: 2 }),
      row({ line: 3, date: localDate(2026, 11, 2) }),
    ];
    const { fresh } = planImport('acc1', overlapping, existing);
    expect(fresh.map((k) => k.row.line)).toEqual([3]);
  });

  it('a third identical chai in a re-export is new (occurrence 3)', () => {
    const existing = new Set(
      planImport('acc1', [row(), row()], new Set()).fresh.map((k) => k.identity),
    );
    const { fresh } = planImport('acc1', [row(), row(), row()], existing);
    expect(fresh.map((k) => k.occurrence)).toEqual([3]);
  });
});
