import { TestBed } from '@angular/core/testing';
import { PdfPasswordError, PdfReadError } from '@ledger/core';
import type { PdfTextItem } from '@ledger/core';
import { PENDING, fakeApi } from '../../testing-api';
import { ApiClient } from '../api/api-client';
import { ImportStore, LAYOUTS, MAX_PDF_BYTES } from './import-store';
import { PdfReader } from './pdf-reader';

const CSV = 'Date,Narration\n01/10/2026,UPI/CHAI POINT\n';

// A two page statement in the FakeBank layout: text positions in PDF points.
const text = (page: number, y: number, x: number, value: string): PdfTextItem => ({
  page,
  x,
  y,
  width: value.length * 5,
  height: 9,
  text: value,
});
const rightText = (page: number, y: number, edge: number, value: string): PdfTextItem =>
  text(page, y, edge - value.length * 5, value);
const titles = (page: number): PdfTextItem[] => [
  text(page, 700, 40, 'Txn Date'),
  text(page, 700, 110, 'Narration'),
  text(page, 700, 300, 'Ref No'),
  text(page, 700, 380, 'Withdrawal Amt'),
  text(page, 700, 470, 'Deposit Amt'),
  text(page, 700, 550, 'Closing Balance'),
];
const STATEMENT: PdfTextItem[] = [
  ...titles(1),
  text(1, 680, 40, '01/10/2026'),
  text(1, 680, 110, 'UPI/CHAI POINT'),
  text(1, 680, 300, 'UPI1'),
  rightText(1, 680, 450, '20.00'),
  rightText(1, 680, 625, '1,09,980.00'),
  ...titles(2),
  text(2, 680, 40, '02/10/2026'),
  text(2, 680, 110, 'SALARY ACME CORP'),
  rightText(2, 680, 525, '85,000.00'),
  rightText(2, 680, 625, '1,94,980.00'),
];
const BYTES = new Uint8Array([37, 80, 68, 70]);

type Read = (bytes: Uint8Array, password: string) => Promise<PdfTextItem[]>;

async function setup(read: Read) {
  const reader = { read: vi.fn(read) };
  const api = fakeApi({ transactions: () => Promise.resolve(PENDING) });
  TestBed.configureTestingModule({
    providers: [
      ImportStore,
      { provide: ApiClient, useValue: api },
      { provide: PdfReader, useValue: reader },
    ],
  });
  const store = TestBed.inject(ImportStore);
  await store.loadAccounts();
  store.setAccount('acc-bank');
  store.setLayout('fakebank-savings');
  store.setPdf('statement.pdf', BYTES);
  return { api, reader, store };
}

describe('ImportStore: PDF statements', () => {
  it('says which layouts have a PDF version', () => {
    expect(LAYOUTS.map((l) => [l.id, l.pdf])).toEqual([
      ['fakebank-savings', true],
      ['democard', false],
    ]);
  });

  it('waits for the PDF to be opened: it is not a CSV yet, so nothing can be previewed', async () => {
    const { store } = await setup(() => Promise.resolve(STATEMENT));
    expect(store.pdfName()).toBe('statement.pdf');
    expect(store.fileName()).toBeNull();
    expect(store.canPreview()).toBe(false);
    expect(store.canReadPdf()).toBe(true);
  });

  it('opens the PDF with the typed password and turns its table into a CSV to preview', async () => {
    const { api, reader, store } = await setup(() => Promise.resolve(STATEMENT));
    await store.readPdf('12345010190');

    expect(reader.read).toHaveBeenCalledWith(BYTES, '12345010190');
    expect(store.fileName()).toBe('statement.pdf');
    expect(store.pdfRead()).toEqual({ pages: 2, rows: 2 });
    expect(store.pdfProblem()).toBeNull();
    expect(store.pdfReading()).toBe(false);
    expect(store.canPreview()).toBe(true);

    await store.preview();
    const sent = api.previewImport.mock.calls[0]?.[0] as { csv: string; mappingId: string };
    expect(sent.mappingId).toBe('fakebank-savings');
    expect(sent.csv.split('\n')).toEqual([
      'Txn Date,Narration,Ref No,Withdrawal Amt,Deposit Amt,Closing Balance',
      '01/10/2026,UPI/CHAI POINT,UPI1,20.00,,"1,09,980.00"',
      '02/10/2026,SALARY ACME CORP,,,"85,000.00","1,94,980.00"',
      '',
    ]);
    // Only the rows travel to the API; the password and the PDF itself never do.
    expect(JSON.stringify(api.previewImport.mock.calls)).not.toContain('12345010190');
  });

  it('asks for a password, or says it was wrong, without repeating it', async () => {
    const { store } = await setup((_bytes, password) =>
      Promise.reject(new PdfPasswordError(password === '' ? 'needed' : 'wrong')),
    );
    await store.readPdf('');
    expect(store.pdfProblem()).toBe(
      'This PDF is password protected. Type its password and try again.',
    );
    expect(store.canPreview()).toBe(false);

    await store.readPdf('hunter2');
    expect(store.pdfProblem()).toBe('That password did not open the PDF. Check it and try again.');
    expect(store.pdfProblem()).not.toContain('hunter2');
    expect(store.fileName()).toBeNull();
    expect(store.canReadPdf()).toBe(true); // it can be tried again
  });

  it('explains a file that is not a readable PDF, without exposing the cause', async () => {
    const { store } = await setup(() =>
      Promise.reject(new PdfReadError('That file could not be read as a PDF.')),
    );
    await store.readPdf('');
    expect(store.pdfProblem()).toBe('That file could not be read as a PDF.');

    TestBed.resetTestingModule();
    const other = await setup(() => Promise.reject(new Error('boom: account 12345')));
    await other.store.readPdf('');
    expect(other.store.pdfProblem()).toBe('Could not read that PDF.');
  });

  it('blocks the import when the table cannot be read cleanly, and says why', async () => {
    const { store } = await setup(() => Promise.resolve([text(1, 700, 40, 'Some other document')]));
    await store.readPdf('');
    expect(store.pdfIssues()).toHaveLength(1);
    expect(store.pdfIssues()[0]?.reason).toMatch(/column titles/i);
    expect(store.fileName()).toBeNull();
    expect(store.canPreview()).toBe(false);
  });

  it('cannot be opened for a bank that has no PDF layout yet', async () => {
    const { reader, store } = await setup(() => Promise.resolve(STATEMENT));
    store.setLayout('democard');
    expect(store.pdfLayoutMissing()).toBe(true);
    expect(store.canReadPdf()).toBe(false);
    await store.readPdf('');
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('keeps the chosen PDF but does not open it before a layout is chosen', async () => {
    const { store } = await setup(() => Promise.resolve(STATEMENT));
    store.setLayout('');
    expect(store.pdfName()).toBe('statement.pdf');
    expect(store.pdfLayoutMissing()).toBe(false);
    expect(store.canReadPdf()).toBe(false);
  });

  it('forgets what it read when the layout changes, so it must be opened again', async () => {
    const { store } = await setup(() => Promise.resolve(STATEMENT));
    await store.readPdf('');
    expect(store.canPreview()).toBe(true);
    store.setLayout('democard');
    store.setLayout('fakebank-savings');
    expect(store.fileName()).toBeNull();
    expect(store.pdfRead()).toBeNull();
    expect(store.canPreview()).toBe(false);
    expect(store.pdfName()).toBe('statement.pdf');
    expect(store.canReadPdf()).toBe(true);
  });

  it('ignores a second open while one is running', async () => {
    let release: (items: PdfTextItem[]) => void = () => undefined;
    const { reader, store } = await setup(
      () => new Promise<PdfTextItem[]>((resolve) => (release = resolve)),
    );
    const first = store.readPdf('');
    expect(store.pdfReading()).toBe(true);
    expect(store.canReadPdf()).toBe(false);
    await store.readPdf('');
    expect(reader.read).toHaveBeenCalledTimes(1);
    release(STATEMENT);
    await first;
    expect(store.pdfReading()).toBe(false);
  });

  it('refuses an empty or oversized PDF without reading it', async () => {
    const { reader, store } = await setup(() => Promise.resolve(STATEMENT));
    store.setPdf('empty.pdf', new Uint8Array());
    expect([store.pdfName(), store.fileError()]).toEqual([null, 'That file is empty.']);
    store.setPdf('huge.pdf', new Uint8Array(MAX_PDF_BYTES + 1));
    expect([store.pdfName(), store.fileError()]).toEqual([
      null,
      'That file is too large to import.',
    ]);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('lets a CSV replace a chosen PDF, and choosing another file forgets the PDF', async () => {
    const { store } = await setup(() => Promise.resolve(STATEMENT));
    await store.readPdf('');
    store.setFile('oct.csv', CSV);
    expect(store.pdfName()).toBeNull();
    expect(store.pdfRead()).toBeNull();
    expect(store.fileName()).toBe('oct.csv');

    store.setPdf('statement.pdf', BYTES);
    expect(store.fileName()).toBeNull();
    store.chooseAnother();
    expect(store.pdfName()).toBeNull();
    expect(store.canReadPdf()).toBe(false);
  });
});
