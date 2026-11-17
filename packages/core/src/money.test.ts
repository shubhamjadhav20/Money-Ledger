import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  absPaise,
  addPaise,
  formatINR,
  negatePaise,
  paise,
  parseAmount,
  subPaise,
  sumPaise,
} from './money.ts';

describe('paise()', () => {
  it.each([0, 1, -1, 725_000, Number.MAX_SAFE_INTEGER])('accepts the integer %d', (n) => {
    expect(paise(n)).toBe(n);
  });

  it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %d',
    (n) => {
      expect(() => paise(n)).toThrow(MoneyError);
    },
  );
});

describe('arithmetic', () => {
  it('adds, subtracts, negates and sums exactly', () => {
    expect(addPaise(paise(10), paise(20))).toBe(30);
    expect(subPaise(paise(10), paise(25))).toBe(-15);
    expect(negatePaise(paise(7)) as number).toBe(-7);
    expect(absPaise(paise(-7))).toBe(7);
    expect(sumPaise([])).toBe(0);
    // The classic float trap: 0.1 + 0.2. In paise it is exact.
    expect(sumPaise([paise(10), paise(20)])).toBe(30);
  });

  it('refuses to overflow past safe integers', () => {
    expect(() => addPaise(paise(Number.MAX_SAFE_INTEGER), paise(1))).toThrow(MoneyError);
  });
});

describe('parseAmount()', () => {
  it.each([
    ['0', 0],
    ['7', 700],
    ['7.5', 750],
    ['7.05', 705],
    ['7,250.00', 725_000],
    ['1,23,456.78', 12_345_678], // Indian grouping
    ['12,34,567', 123_456_700],
    ['123,456.78', 12_345_678], // western grouping
    ['  42.10  ', 4210],
    ['₹1,500', 150_000],
    ['Rs. 99.99', 9999],
    ['Rs 5', 500],
    ['INR 20', 2000],
    ['-20', -2000],
    ['+20', 2000],
    ['(1,250.50)', -125_050], // accounting negative
    ['-₹20', -2000],
    ['0.10', 10],
    ['0.20', 20],
  ])('parses %j as %d paise', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    'abc',
    '1.234', // more than 2 decimals: refuse rather than round
    '1,2,3',
    '12,345,67',
    '1,23,4567',
    '--5',
    '(5',
    '5)',
    '1e3',
    '0x10',
    '.5',
    '5.',
    '99999999999999999',
  ])('rejects %j', (input) => {
    expect(() => parseAmount(input)).toThrow(MoneyError);
  });
});

describe('formatINR()', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [725_000, '₹7,250.00'],
    [12_345_678, '₹1,23,456.78'],
    [-500, '-₹5.00'],
    [Number.MAX_SAFE_INTEGER, '₹9,00,71,99,25,47,409.91'],
  ])('formats %d paise as %s', (input, expected) => {
    expect(formatINR(paise(input))).toBe(expected);
  });

  it('round-trips through parseAmount', () => {
    for (const n of [0, 1, 99, 100, 12_345_678, -725_000]) {
      expect(parseAmount(formatINR(paise(n)))).toBe(n);
    }
  });
});
