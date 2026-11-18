import { describe, expect, it } from 'vitest';
import { CsvError, formatCsvRecord, parseCsv } from './csv.ts';

const fields = (text: string): string[][] => parseCsv(text).map((r) => r.fields);

describe('parseCsv()', () => {
  it('splits simple rows', () => {
    expect(fields('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF, CR and a trailing newline', () => {
    expect(fields('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(fields('a\r1')).toEqual([['a'], ['1']]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(fields('﻿Date,Amount')).toEqual([['Date', 'Amount']]);
  });

  it('handles quoted fields with commas, quotes and newlines', () => {
    expect(fields('"Smith, J","He said ""hi""","line1\nline2"')).toEqual([
      ['Smith, J', 'He said "hi"', 'line1\nline2'],
    ]);
  });

  it('keeps empty fields and blank lines as rows', () => {
    expect(fields('a,,c\n\n,')).toEqual([['a', '', 'c'], [''], ['', '']]);
  });

  it('reports the starting line of each record', () => {
    const rows = parseCsv('h1,h2\n"multi\nline",x\nlast,y');
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('supports another delimiter', () => {
    expect(parseCsv('a;b', ';').map((r) => r.fields)).toEqual([['a', 'b']]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a,"oops\n1,2')).toThrow(CsvError);
  });

  it('rejects text after a closing quote', () => {
    expect(() => parseCsv('"a"b,c')).toThrow(CsvError);
  });
});

describe('formatCsvRecord()', () => {
  it('joins plain fields and quotes only when needed', () => {
    expect(formatCsvRecord(['a', 'b c', ''])).toBe('a,b c,');
    expect(formatCsvRecord(['1,23,456.78', 'say "hi"', 'two\nlines'])).toBe(
      '"1,23,456.78","say ""hi""","two\nlines"',
    );
  });

  it('round-trips through parseCsv, including awkward text', () => {
    const awkward = ['UPI/SHOP, BRANCH 7', 'He said "no"', 'a\r\nb', '', ' padded ', '₹ 1,00,000'];
    expect(parseCsv(formatCsvRecord(awkward))[0]?.fields).toEqual(awkward);
  });

  it('honours another delimiter', () => {
    expect(formatCsvRecord(['a;b', 'c'], ';')).toBe('"a;b";c');
  });
});
