import { parseLocalDate } from '@ledger/core';
import { paise } from '@ledger/core';
import { formatDay, plainAmount, plural, todayFromPayday } from './format';

const date = (text: string) => parseLocalDate(text, 'yyyy-mm-dd');

describe('formatting', () => {
  it('writes a calendar date the way people say it, whatever the time zone', () => {
    expect(formatDay(date('2026-12-07'))).toBe('Mon, 7 Dec');
    expect(formatDay(date('2027-01-01'))).toBe('Fri, 1 Jan');
  });

  it('pluralises', () => {
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(0, 'day')).toBe('0 days');
    expect(plural(20, 'day')).toBe('20 days');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
  });

  it("recovers the server's today from its payday answer", () => {
    expect(todayFromPayday(date('2026-12-07'), 20)).toBe('2026-11-17');
    expect(todayFromPayday(date('2027-01-07'), 1)).toBe('2027-01-06');
  });

  it('writes an amount as it would be typed back in, using whole numbers only', () => {
    expect(plainAmount(paise(1_000_000))).toBe('10000');
    expect(plainAmount(paise(1_050))).toBe('10.50');
    expect(plainAmount(paise(5))).toBe('0.05');
    expect(plainAmount(paise(0))).toBe('0');
    expect(plainAmount(paise(-12_345))).toBe('-123.45');
    expect(plainAmount(paise(Number.MAX_SAFE_INTEGER - 6))).toBe('90071992547409.85');
  });
});
