import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PdfLine } from '../../packages/core/src/index.ts';
import { formatSkeleton, maskText, parseLineSelection } from './skeleton.ts';

describe('maskText()', () => {
  it('keeps the shape of a line but none of its content', () => {
    expect(maskText('Ramesh Kumar paid 5,000.00 on 05/11/2026')).toBe(
      'Xxxxxx Xxxxx xxxx 9,999.99 xx 99/99/9999',
    );
    expect(maskText('UPI/CHAI POINT/UPI1011')).toBe('XXX/XXXX XXXXX/XXX9999');
  });

  it('treats every script alike: no letter or digit of the input survives', () => {
    expect(maskText('Zoë 田中 ٣٤ ½')).toBe('Xxx xx 99 9');
  });

  it('never leaks, for any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const masked = maskText(text);
        const expected = Array.from(text)
          .map((ch) =>
            /\p{Lu}/u.test(ch) ? 'X' : /\p{L}/u.test(ch) ? 'x' : /\p{N}/u.test(ch) ? '9' : ch,
          )
          .join('');
        expect(masked).toBe(expected);
        // Masking twice changes nothing, and the output has no other letters than the mask's own.
        expect(maskText(masked)).toBe(masked);
        expect(masked.replaceAll(/[Xx9]/gu, '')).toBe(
          Array.from(text)
            .filter((ch) => !/[\p{L}\p{N}]/u.test(ch))
            .join(''),
        );
      }),
    );
  });
});

describe('parseLineSelection()', () => {
  it('reads numbers and ranges', () => {
    expect([...parseLineSelection('14')]).toEqual([14]);
    expect([...parseLineSelection(' 3, 5-7 ,12 ')].sort((a, b) => a - b)).toEqual([3, 5, 6, 7, 12]);
    expect(parseLineSelection('').size).toBe(0);
  });

  it.each(['abc', '0', '-3', '7-5', '1-', '1,,2', '1-5000', '1.5'])('rejects %j', (spec) => {
    expect(() => parseLineSelection(spec)).toThrow();
  });
});

const line = (page: number, y: number, ...cells: [number, number, string][]): PdfLine => ({
  page,
  y,
  height: 8,
  cells: cells.map(([x, right, text]) => ({ x, right, text })),
});

const titles = (page: number, y: number): PdfLine =>
  line(page, y, [40, 80, 'Date'], [100, 150, 'Narration'], [380, 450, 'Withdrawal Amt']);

describe('formatSkeleton()', () => {
  const lines = [
    line(1, 800, [40, 200, 'Mr Ramesh Kumar, Flat 12, Some Road']),
    titles(1, 700),
    line(1, 680, [40, 80, '05/11/2026'], [100, 190, 'UPI/ASHA RAO'], [420, 450, '1,250.00']),
    line(2, 800, [40, 100, 'Page 2']),
    titles(2, 700),
    line(2, 680, [40, 80, '06/11/2026'], [100, 190, 'UPI/BAKERY'], [420, 450, '312.00']),
  ];

  it('masks every line by default, so nothing personal is printed', () => {
    const text = formatSkeleton(lines, new Set());
    expect(text).not.toMatch(/Ramesh|Kumar|ASHA|BAKERY|1,250|05\/11|Some Road/);
    expect(text).toContain('Xx Xxxxxx Xxxxx, Xxxx 99, Xxxx Xxxx');
    expect(text).toContain('99/99/9999');
    expect(text).toContain('9,999.99');
  });

  it('numbers lines across pages and shows where each cell sits', () => {
    const text = formatSkeleton(lines, new Set());
    expect(text).toMatch(/^L001\s+y=800\.0\s+\[x40\.0-200\.0\]/mu);
    expect(text).toMatch(/^L004\s/mu);
    expect(text).toContain('== page 2 ==');
    expect(text).toMatch(/\[x380\.0-450\.0\] Xxxxxxxxxx Xxx/u);
  });

  it('shows only the lines asked for exactly as printed, and marks them', () => {
    const text = formatSkeleton(lines, new Set([2]));
    expect(text).toMatch(/^L002\*/mu);
    expect(text).toContain('Withdrawal Amt');
    expect(text).not.toContain('Ramesh');
    // Other lines stay masked, including the identical title row on page 2 (line 5).
    expect(text.match(/Withdrawal Amt/g)).toHaveLength(1);
  });

  it('points at rows that repeat on every page, where the column titles usually are', () => {
    expect(formatSkeleton(lines, new Set())).toMatch(/Repeat on every page.*L002.*L005/su);
  });

  it('says what it is and what it hides', () => {
    const text = formatSkeleton(lines, new Set());
    expect(text).toMatch(/2 pages, 6 lines/u);
    expect(text).toMatch(/letters.*x.*digits.*9/isu);
  });

  it('handles an empty document', () => {
    expect(formatSkeleton([], new Set())).toMatch(/0 pages, 0 lines/u);
  });
});
