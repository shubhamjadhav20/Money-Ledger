import { parseLocalDate } from '@ledger/core';
import { parseCapture } from '@ledger/core';
import { composeCapture } from './compose';
import type { QuickAddFields } from './compose';

const today = parseLocalDate('2026-11-17', 'yyyy-mm-dd');
const base: QuickAddFields = {
  direction: 'spent',
  amount: '450',
  category: 'dinner',
  note: '',
  method: 'upi',
  day: 'today',
};

describe('composeCapture', () => {
  it('writes the fields in grammar order', () => {
    expect(
      composeCapture({ ...base, note: 'with friends', method: 'card', day: 'yesterday' }),
    ).toBe('450 dinner with friends card yesterday');
  });

  it('marks money coming in with "got"', () => {
    expect(
      composeCapture({ ...base, direction: 'received', amount: '5000', category: 'salary' }),
    ).toBe('got 5000 salary upi today');
  });

  it('drops empty fields instead of leaving gaps', () => {
    expect(composeCapture({ ...base, amount: '', category: '' })).toBe('upi today');
  });

  it('keeps each field to its slot: no spaces in the amount, no sign, hyphens in the category', () => {
    expect(composeCapture({ ...base, amount: ' +1 200 ', category: ' eating  out ' })).toBe(
      '1200 eating-out upi today',
    );
    expect(composeCapture({ ...base, amount: '-80' })).toBe('80 dinner upi today');
  });

  it('collapses runs of spaces in the note', () => {
    expect(composeCapture({ ...base, note: '  tea   and  samosa ' })).toBe(
      '450 dinner tea and samosa upi today',
    );
  });

  describe('read by the shared grammar', () => {
    const read = (fields: QuickAddFields) => parseCapture(composeCapture(fields), { today });

    it('a spend becomes a negative amount with the chosen method and day', () => {
      const result = read({ ...base, method: 'cash', day: 'yesterday' });
      expect(result).toMatchObject({
        ok: true,
        entry: {
          amount: -45_000,
          method: 'cash',
          date: '2026-11-16',
          kind: 'spend',
          category: 'dinner',
        },
      });
    });

    it('received becomes income', () => {
      expect(
        read({ ...base, direction: 'received', category: 'salary', amount: '5000' }),
      ).toMatchObject({
        ok: true,
        entry: { amount: 500_000, kind: 'income' },
      });
    });

    it('a note that holds a different method word is refused, not guessed', () => {
      const result = read({ ...base, method: 'cash', note: 'paid by upi' });
      expect(result).toEqual({
        ok: false,
        error: 'Two payment methods given: use only one of upi, card, cash, netbanking',
      });
    });

    it('a missing amount or category is explained', () => {
      expect(read({ ...base, amount: '' })).toMatchObject({ ok: false });
      expect(read({ ...base, category: '' })).toEqual({
        ok: false,
        error: 'Missing category: e.g. "20 food upi"',
      });
    });
  });
});
