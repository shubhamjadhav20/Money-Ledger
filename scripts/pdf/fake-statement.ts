/**
 * Draws the FAKE FakeBank statement as a PDF, optionally password protected, entirely in memory.
 * Used by tests and by `pnpm fixtures:pdf`. The look mimics a real statement on purpose: page
 * furniture, a repeated header row on every page, right-aligned amounts, narrations that wrap onto
 * a second line, an opening balance above the first row and an end marker. All names are invented.
 */
import PDFDocument from 'pdfkit';
import type { PrintedRow } from '../fixtures/generate.ts';

export const FAKE_PDF_PASSWORD = 'demo-password';

export type PdfEncryption = 'rc4-128' | 'aes-128' | 'aes-256';
const PDF_VERSION: Record<PdfEncryption, string> = {
  'rc4-128': '1.4',
  'aes-128': '1.7',
  'aes-256': '1.7ext3',
};

export interface FakeStatementOptions {
  readonly openingBalance: string;
  /** Leave out for an unprotected PDF. */
  readonly password?: string;
  readonly encryption?: PdfEncryption;
  readonly rowsPerPage?: number;
}

// Columns, in points. Amounts are right-aligned to the `right` edges, titles too.
const DATE_X = 40;
const NARRATION_X = 100;
const NARRATION_WIDTH = 100;
const REF_X = 215;
const WITHDRAWAL_RIGHT = 345;
const DEPOSIT_RIGHT = 425;
const BALANCE_RIGHT = 510;
const AMOUNT_WIDTH = 90;

export function fakeStatementPdf(
  rows: readonly PrintedRow[],
  options: FakeStatementOptions,
): Promise<Uint8Array> {
  const rowsPerPage = options.rowsPerPage ?? 12;
  const { password } = options;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: { Title: 'FakeBank statement (DEMO DATA)' },
      ...(password === undefined
        ? {}
        : {
            userPassword: password,
            ownerPassword: `${password}-owner`,
            pdfVersion: PDF_VERSION[options.encryption ?? 'aes-256'],
          }),
    });
    const chunks: Uint8Array[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => {
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });

    const right = (text: string, edge: number, y: number): void => {
      doc.text(text, edge - AMOUNT_WIDTH, y, {
        width: AMOUNT_WIDTH,
        align: 'right',
        lineBreak: false,
      });
    };

    const titles = (y: number): number => {
      doc.font('Helvetica-Bold').fontSize(8);
      doc.text('Txn Date', DATE_X, y, { lineBreak: false });
      doc.text('Narration', NARRATION_X, y, { lineBreak: false });
      doc.text('Ref No', REF_X, y, { lineBreak: false });
      right('Withdrawal Amt', WITHDRAWAL_RIGHT, y);
      right('Deposit Amt', DEPOSIT_RIGHT, y);
      right('Closing Balance', BALANCE_RIGHT, y);
      doc.font('Helvetica').fontSize(8);
      return y + 16;
    };

    let y = 0;
    let page = 0;
    const startPage = (): void => {
      page += 1;
      if (page > 1) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('FakeBank Ltd (DEMO DATA - NOT A REAL BANK)', DATE_X, 30, { lineBreak: false });
      doc.font('Helvetica').fontSize(8);
      if (page === 1) {
        doc.text('Account Holder: DEMO USER', DATE_X, 46, { lineBreak: false });
        doc.text('Statement Period: 01/10/2026 to 31/10/2026', DATE_X, 58, { lineBreak: false });
        y = titles(90);
        doc.text('Opening Balance', NARRATION_X, y, { lineBreak: false });
        right(options.openingBalance, BALANCE_RIGHT, y);
        y += 14;
      } else {
        y = titles(60);
      }
      doc.text(`Page ${String(page)}`, 280, 800, { lineBreak: false });
    };

    startPage();
    rows.forEach((row, index) => {
      if (index > 0 && index % rowsPerPage === 0) startPage();
      const height = doc.heightOfString(row.narration, { width: NARRATION_WIDTH });
      doc.text(row.date, DATE_X, y, { lineBreak: false });
      doc.text(row.narration, NARRATION_X, y, { width: NARRATION_WIDTH });
      if (row.ref !== '') doc.text(row.ref, REF_X, y, { lineBreak: false });
      if (row.withdrawal !== '') right(row.withdrawal, WITHDRAWAL_RIGHT, y);
      if (row.deposit !== '') right(row.deposit, DEPOSIT_RIGHT, y);
      right(row.balance, BALANCE_RIGHT, y);
      y += Math.max(height, 10) + 4;
    });
    doc.text('*** End of Statement ***', NARRATION_X, y + 6, { lineBreak: false });
    doc.end();
  });
}
