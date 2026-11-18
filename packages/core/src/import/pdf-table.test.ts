import { describe, expect, it } from 'vitest';
import { createCsvImporter } from './csv-importer.ts';
import { FAKEBANK_SAVINGS } from './demo-mappings.ts';
import { pdfTableToCsv, validatePdfLayout } from './pdf-table.ts';
import type { PdfLayout, PdfTextItem } from './pdf-table.ts';

// Geometry of a fake statement (PDF points; y grows upward). Text is 5 points wide per character.
//   Txn Date [40,80]  Narration [110,155]  Ref No [300,330]
//   Withdrawal Amt [380,450] (amounts right-aligned to 450)  Deposit Amt [470,525] (right 525)
//   Closing Balance [550,625] (right 625)
const H = 9;
const item = (page: number, y: number, x: number, text: string): PdfTextItem => ({
  page,
  x,
  y,
  width: text.length * 5,
  height: H,
  text,
});
const rightItem = (page: number, y: number, right: number, text: string): PdfTextItem =>
  item(page, y, right - text.length * 5, text);

const header = (page: number, y: number): PdfTextItem[] => [
  item(page, y, 40, 'Txn Date'),
  item(page, y, 110, 'Narration'),
  item(page, y, 300, 'Ref No'),
  item(page, y, 380, 'Withdrawal Amt'),
  item(page, y, 470, 'Deposit Amt'),
  item(page, y, 550, 'Closing Balance'),
];

interface Txn {
  readonly date: string;
  readonly narration: string;
  readonly ref?: string;
  readonly withdrawal?: string;
  readonly deposit?: string;
  readonly balance: string;
}
const txn = (page: number, y: number, t: Txn): PdfTextItem[] => [
  item(page, y, 40, t.date),
  item(page, y, 110, t.narration),
  ...(t.ref === undefined ? [] : [item(page, y, 300, t.ref)]),
  ...(t.withdrawal === undefined ? [] : [rightItem(page, y, 450, t.withdrawal)]),
  ...(t.deposit === undefined ? [] : [rightItem(page, y, 525, t.deposit)]),
  rightItem(page, y, 625, t.balance),
];

const layout: PdfLayout = {
  id: 'fakebank-savings-pdf',
  label: 'FakeBank savings (PDF)',
  mapping: FAKEBANK_SAVINGS,
  columns: [
    { label: 'Txn Date' },
    { label: 'Narration' },
    { label: 'Ref No' },
    { label: 'Withdrawal Amt' },
    { label: 'Deposit Amt' },
    { label: 'Closing Balance' },
  ],
  continuationColumns: ['Narration'],
  ignoreLines: ['Page '],
  endMarkers: ['End of Statement'],
};

const HEADER_LINE = 'Txn Date,Narration,Ref No,Withdrawal Amt,Deposit Amt,Closing Balance';
const chai: Txn = {
  date: '01/11/2026',
  narration: 'UPI/CHAI POINT',
  ref: 'UPI1',
  withdrawal: '20.00',
  balance: '1,09,980.00',
};
const salary: Txn = {
  date: '02/11/2026',
  narration: 'SALARY ACME CORP',
  deposit: '85,000.00',
  balance: '1,94,980.00',
};

describe('pdfTableToCsv()', () => {
  it('rebuilds the table as CSV that the bank layout can read', () => {
    const items = [
      item(1, 800, 40, 'FakeBank Ltd (DEMO)'),
      ...header(1, 700),
      ...txn(1, 680, chai),
      ...txn(1, 668, salary),
    ];
    const result = pdfTableToCsv(items, layout);

    expect(result.issues).toEqual([]);
    expect(result.rowCount).toBe(2);
    expect(result.csv.split('\n')).toEqual([
      HEADER_LINE,
      '01/11/2026,UPI/CHAI POINT,UPI1,20.00,,"1,09,980.00"',
      '02/11/2026,SALARY ACME CORP,,,"85,000.00","1,94,980.00"',
      '',
    ]);

    const parsed = createCsvImporter(FAKEBANK_SAVINGS).parse(result.csv);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows.map((r) => [r.date, r.amount, r.counterparty])).toEqual([
      ['2026-11-01', -2000, 'UPI/CHAI POINT'],
      ['2026-11-02', 8_500_000, 'SALARY ACME CORP'],
    ]);
  });

  it('does not depend on the order the items arrive in', () => {
    const items = [
      item(1, 800, 40, 'FakeBank Ltd (DEMO)'),
      ...header(1, 700),
      ...txn(1, 680, chai),
      ...txn(1, 668, salary),
    ];
    expect(pdfTableToCsv([...items].reverse(), layout)).toEqual(pdfTableToCsv(items, layout));
  });

  it('joins a wrapped narration line to the row above it', () => {
    const items = [
      ...header(1, 700),
      ...txn(1, 680, { ...chai, narration: 'UPI/AN EXTREMELY LONG MERCHANT' }),
      item(1, 670, 110, 'NAME, BRANCH 7'),
      ...txn(1, 658, salary),
    ];
    const { csv, issues } = pdfTableToCsv(items, layout);
    expect(issues).toEqual([]);
    expect(createCsvImporter(FAKEBANK_SAVINGS).parse(csv).rows[0]?.counterparty).toBe(
      'UPI/AN EXTREMELY LONG MERCHANT NAME, BRANCH 7',
    );
  });

  it('reads several pages: repeated headers and page furniture are skipped', () => {
    const items = [
      ...header(1, 700),
      ...txn(1, 680, chai),
      item(1, 40, 280, 'Page 1 of 2'),
      item(2, 800, 40, 'FakeBank Ltd (DEMO)'),
      ...header(2, 760),
      ...txn(2, 740, salary),
      item(2, 40, 280, 'Page 2 of 2'),
    ];
    const { csv, rowCount, issues } = pdfTableToCsv(items, layout);
    expect(issues).toEqual([]);
    expect(rowCount).toBe(2);
    expect(csv.split('\n')).toHaveLength(4);
    expect(csv.match(/Txn Date/g)).toHaveLength(1);
  });

  it('stops at an end marker and ignores everything after it', () => {
    const items = [
      ...header(1, 700),
      ...txn(1, 680, chai),
      item(1, 660, 40, '*** End of Statement ***'),
      ...txn(1, 640, salary),
    ];
    expect(pdfTableToCsv(items, layout).rowCount).toBe(1);
  });

  it('ignores lines before the first transaction, such as an opening balance', () => {
    const items = [
      ...header(1, 700),
      item(1, 690, 110, 'Opening Balance'),
      rightItem(1, 690, 625, '1,10,000.00'),
      ...txn(1, 678, chai),
    ];
    const { rowCount, issues } = pdfTableToCsv(items, layout);
    expect(issues).toEqual([]);
    expect(rowCount).toBe(1);
  });

  it('puts wide right-aligned amounts in their own column', () => {
    const items = [
      ...header(1, 700),
      ...txn(1, 680, {
        date: '03/11/2026',
        narration: 'UPI/BIG PURCHASE',
        withdrawal: '12,34,567.00',
        balance: '1,23,45,678.90',
      }),
    ];
    const { csv } = pdfTableToCsv(items, layout);
    const parsed = createCsvImporter(FAKEBANK_SAVINGS).parse(csv);
    expect(parsed.rows[0]?.amount).toBe(-123_456_700);
  });

  it('finds a column title printed as two separate words', () => {
    const split = [
      item(1, 700, 40, 'Txn Date'),
      item(1, 700, 110, 'Narration'),
      item(1, 700, 300, 'Ref No'),
      item(1, 700, 380, 'Withdrawal'),
      item(1, 700, 435, 'Amt'),
      item(1, 700, 470, 'Deposit Amt'),
      item(1, 700, 550, 'Closing Balance'),
    ];
    const { rowCount, issues } = pdfTableToCsv([...split, ...txn(1, 680, chai)], layout);
    expect(issues).toEqual([]);
    expect(rowCount).toBe(1);
  });

  it('treats slightly different baselines as one line', () => {
    const items = [
      ...header(1, 700),
      item(1, 680, 40, '01/11/2026'),
      item(1, 679.2, 110, 'UPI/CHAI POINT'),
      item(1, 680.6, 300, 'UPI1'),
      rightItem(1, 679.5, 450, '20.00'),
      rightItem(1, 680.3, 625, '1,09,980.00'),
    ];
    const { rowCount, issues } = pdfTableToCsv(items, layout);
    expect(issues).toEqual([]);
    expect(rowCount).toBe(1);
  });

  it('says so when the column titles are not on the page', () => {
    const result = pdfTableToCsv([item(1, 700, 40, 'Some other document')], layout);
    expect(result.csv).toBe('');
    expect(result.rowCount).toBe(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.reason).toMatch(/column titles/i);
  });

  it('says so when there are titles but no transactions', () => {
    const result = pdfTableToCsv(header(1, 700), layout);
    expect(result.rowCount).toBe(0);
    expect(result.issues[0]?.reason).toMatch(/no transactions/i);
  });

  it('flags text that belongs to no transaction instead of dropping it', () => {
    const items = [
      ...header(1, 700),
      ...txn(1, 680, chai),
      // No date, and an amount: it cannot be part of the row above.
      item(1, 668, 110, 'MYSTERY LINE'),
      rightItem(1, 668, 450, '999.00'),
    ];
    const { issues, rowCount } = pdfTableToCsv(items, layout);
    expect(rowCount).toBe(1);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/page 1/i);
    expect(issues[0]?.reason).not.toMatch(/MYSTERY|999/);
  });

  it('flags a row whose date cannot be read, because its amounts would otherwise vanish', () => {
    const items = [
      ...header(1, 700),
      ...txn(1, 680, chai),
      ...txn(1, 668, { ...salary, date: '31/02/2026' }),
    ];
    const { issues, rowCount } = pdfTableToCsv(items, layout);
    expect(rowCount).toBe(1);
    expect(issues).toHaveLength(1);
  });
});

describe('validatePdfLayout()', () => {
  it('accepts a layout whose columns cover the CSV mapping', () => {
    expect(validatePdfLayout(layout)).toEqual([]);
  });

  it('names a mapping column that no PDF column supplies', () => {
    const missing = { ...layout, columns: layout.columns.filter((c) => c.label !== 'Ref No') };
    expect(validatePdfLayout(missing).join(' ')).toMatch(/Ref No/);
  });

  it('accepts a PDF title that differs from the CSV column name via `as`', () => {
    const renamed: PdfLayout = {
      ...layout,
      columns: layout.columns.map((c) =>
        c.label === 'Withdrawal Amt' ? { label: 'Debit (INR)', as: 'Withdrawal Amt' } : c,
      ),
    };
    expect(validatePdfLayout(renamed)).toEqual([]);
    const items = [
      item(1, 700, 40, 'Txn Date'),
      item(1, 700, 110, 'Narration'),
      item(1, 700, 300, 'Ref No'),
      item(1, 700, 380, 'Debit (INR)'),
      item(1, 700, 470, 'Deposit Amt'),
      item(1, 700, 550, 'Closing Balance'),
      ...txn(1, 680, chai),
    ];
    const { csv, issues } = pdfTableToCsv(items, renamed);
    expect(issues).toEqual([]);
    expect(csv.split('\n')[0]).toBe(HEADER_LINE);
  });

  it('rejects unknown continuation columns, duplicates and an empty layout', () => {
    expect(validatePdfLayout({ ...layout, continuationColumns: ['Nope'] }).join(' ')).toMatch(
      /Nope/,
    );
    expect(
      validatePdfLayout({ ...layout, columns: [...layout.columns, { label: 'Narration' }] }),
    ).not.toEqual([]);
    expect(validatePdfLayout({ ...layout, columns: [] })).not.toEqual([]);
  });
});
