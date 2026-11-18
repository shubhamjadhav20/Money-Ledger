/**
 * End to end, with the real pdf.js: a FAKE password-protected statement PDF is drawn in memory,
 * opened, turned back into a table and read with the bank's CSV layout. The result must equal the
 * transactions of the CSV fixture made from the same data. Nothing binary is committed.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FAKEBANK_SAVINGS,
  FAKEBANK_SAVINGS_PDF,
  PdfPasswordError,
  PdfReadError,
  createCsvImporter,
  pdfTableToCsv,
  readPdfTextItems,
} from '../../packages/core/src/index.ts';
import type { PdfJsLike, RawRow } from '../../packages/core/src/index.ts';
import { fakeSavingsStatement, generateFixtures } from '../fixtures/generate.ts';
import { FAKE_PDF_PASSWORD, fakeStatementPdf } from './fake-statement.ts';
import type { PdfEncryption } from './fake-statement.ts';

let pdfjs: PdfJsLike;
beforeAll(async () => {
  // pdf.js prints warnings about the optional native canvas when it loads; they are harmless here.
  const quiet = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  ];
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } finally {
    for (const spy of quiet) spy.mockRestore();
  }
});

const key = (row: RawRow): string =>
  [row.date, row.amount, row.counterparty, row.ref ?? ''].join('|');

const statement = fakeSavingsStatement();
const csvFixture = generateFixtures().find((f) => f.mappingId === 'fakebank-savings');
const expectedRows = createCsvImporter(FAKEBANK_SAVINGS).parse(csvFixture?.content ?? '').rows;

describe('the fake statement', () => {
  it('has enough rows to span several pages and the same data as the CSV', () => {
    expect(statement.rows).toHaveLength(31);
    expect(expectedRows).toHaveLength(31);
  });
});

describe.each<PdfEncryption>(['rc4-128', 'aes-128', 'aes-256'])(
  'a password-protected PDF (%s)',
  (encryption) => {
    const pdf = fakeStatementPdf(statement.rows, {
      openingBalance: statement.openingBalance,
      password: FAKE_PDF_PASSWORD,
      encryption,
    });

    it('asks for a password when none is given', async () => {
      const error = await readPdfTextItems(pdfjs, await pdf, '').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PdfPasswordError);
      expect((error as PdfPasswordError).reason).toBe('needed');
    });

    it('rejects a wrong password without saying what it was', async () => {
      const error = await readPdfTextItems(pdfjs, await pdf, 'not-the-password').catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(PdfPasswordError);
      expect((error as PdfPasswordError).reason).toBe('wrong');
      expect((error as Error).message).not.toContain('not-the-password');
    });

    it('opens with the right password and yields exactly the transactions of the CSV', async () => {
      const items = await readPdfTextItems(pdfjs, await pdf, FAKE_PDF_PASSWORD);
      expect(new Set(items.map((i) => i.page)).size).toBeGreaterThanOrEqual(3);

      const table = pdfTableToCsv(items, FAKEBANK_SAVINGS_PDF);
      expect(table.issues).toEqual([]);
      expect(table.rowCount).toBe(31);

      const parsed = createCsvImporter(FAKEBANK_SAVINGS).parse(table.csv);
      expect(parsed.issues).toEqual([]);
      expect(parsed.rows.map(key)).toEqual(expectedRows.map(key));
    });
  },
);

describe('other PDFs', () => {
  it('reads an unprotected statement the same way, with no password', async () => {
    const pdf = await fakeStatementPdf(statement.rows, {
      openingBalance: statement.openingBalance,
    });
    const table = pdfTableToCsv(await readPdfTextItems(pdfjs, pdf, ''), FAKEBANK_SAVINGS_PDF);
    expect(table.issues).toEqual([]);
    expect(createCsvImporter(FAKEBANK_SAVINGS).parse(table.csv).rows.map(key)).toEqual(
      expectedRows.map(key),
    );
  });

  it('survives a different page length (one row per page)', async () => {
    const pdf = await fakeStatementPdf(statement.rows.slice(0, 5), {
      openingBalance: statement.openingBalance,
      rowsPerPage: 1,
    });
    const table = pdfTableToCsv(await readPdfTextItems(pdfjs, pdf, ''), FAKEBANK_SAVINGS_PDF);
    expect(table.issues).toEqual([]);
    expect(table.rowCount).toBe(5);
  });

  it('turns a file that is not a PDF into a safe, fixed error', async () => {
    const junk = new TextEncoder().encode(
      'this is definitely not a pdf, it mentions account 12345',
    );
    const error = await readPdfTextItems(pdfjs, junk, '').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfReadError);
    expect((error as Error).message).not.toMatch(/12345/);
  });

  it('reports a statement with no transactions instead of an empty import', async () => {
    const pdf = await fakeStatementPdf([], { openingBalance: statement.openingBalance });
    const table = pdfTableToCsv(await readPdfTextItems(pdfjs, pdf, ''), FAKEBANK_SAVINGS_PDF);
    expect(table.rowCount).toBe(0);
    expect(table.issues[0]?.reason).toMatch(/no transactions/i);
  });
});
