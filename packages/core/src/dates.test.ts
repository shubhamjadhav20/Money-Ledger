import { describe, expect, it } from 'vitest';
import { DateError, addDays, daysBetween, localDate, parseLocalDate } from './dates.ts';

describe('localDate()', () => {
  it('builds zero-padded ISO calendar dates', () => {
    expect(localDate(2026, 1, 5)).toBe('2026-01-05');
  });

  it.each([
    [2026, 2, 29], // not a leap year
    [2026, 13, 1],
    [2026, 0, 1],
    [2026, 4, 31],
    [1899, 1, 1],
  ])('rejects %d-%d-%d', (y, m, d) => {
    expect(() => localDate(y, m, d)).toThrow(DateError);
  });

  it('accepts 29 Feb in a leap year', () => {
    expect(localDate(2028, 2, 29)).toBe('2028-02-29');
  });
});

describe('parseLocalDate()', () => {
  it.each([
    ['2026-11-05', 'yyyy-mm-dd', '2026-11-05'],
    ['05/11/2026', 'dd/mm/yyyy', '2026-11-05'],
    ['5/11/2026', 'dd/mm/yyyy', '2026-11-05'],
    ['05/11/26', 'dd/mm/yy', '2026-11-05'],
    ['05-11-2026', 'dd-mm-yyyy', '2026-11-05'],
    ['05-11-26', 'dd-mm-yy', '2026-11-05'],
    ['05-Nov-2026', 'dd-mmm-yyyy', '2026-11-05'],
    ['05-nov-26', 'dd-mmm-yy', '2026-11-05'],
    ['05 Nov 2026', 'dd mmm yyyy', '2026-11-05'],
    ['  05/11/2026 ', 'dd/mm/yyyy', '2026-11-05'],
  ] as const)('parses %j with %s', (input, format, expected) => {
    expect(parseLocalDate(input, format)).toBe(expected);
  });

  it.each([
    ['11/05/2026x', 'dd/mm/yyyy'],
    ['31/02/2026', 'dd/mm/yyyy'],
    ['2026/11/05', 'dd/mm/yyyy'],
    ['05-Foo-2026', 'dd-mmm-yyyy'],
    ['', 'yyyy-mm-dd'],
    ['05/11/2026', 'dd/mm/yy'],
  ] as const)('rejects %j with %s', (input, format) => {
    expect(() => parseLocalDate(input, format)).toThrow(DateError);
  });
});

describe('day arithmetic', () => {
  it('adds days across month, year and leap boundaries', () => {
    expect(addDays(localDate(2026, 1, 31), 1)).toBe('2026-02-01');
    expect(addDays(localDate(2026, 12, 31), 1)).toBe('2027-01-01');
    expect(addDays(localDate(2028, 2, 28), 1)).toBe('2028-02-29');
    expect(addDays(localDate(2026, 3, 1), -1)).toBe('2026-02-28');
  });

  it('counts calendar days between dates (signed)', () => {
    expect(daysBetween(localDate(2026, 11, 1), localDate(2026, 11, 4))).toBe(3);
    expect(daysBetween(localDate(2026, 11, 4), localDate(2026, 11, 1))).toBe(-3);
    expect(daysBetween(localDate(2026, 12, 30), localDate(2027, 1, 2))).toBe(3);
  });
});
