import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PdfPasswordError } from '@ledger/core';
import type { PdfTextItem } from '@ledger/core';
import { must, query } from '../../testing';
import { PENDING, fakeApi } from '../../testing-api';
import { ApiClient } from '../api/api-client';
import { ImportScreen } from './import-screen';
import { PdfReader } from './pdf-reader';

const text = (page: number, y: number, x: number, value: string): PdfTextItem => ({
  page,
  x,
  y,
  width: value.length * 5,
  height: 9,
  text: value,
});
const STATEMENT: PdfTextItem[] = [
  text(1, 700, 40, 'Txn Date'),
  text(1, 700, 110, 'Narration'),
  text(1, 700, 300, 'Ref No'),
  text(1, 700, 380, 'Withdrawal Amt'),
  text(1, 700, 470, 'Deposit Amt'),
  text(1, 700, 550, 'Closing Balance'),
  text(1, 680, 40, '01/10/2026'),
  text(1, 680, 110, 'UPI/CHAI POINT'),
  text(1, 680, 300, 'UPI1'),
  text(1, 680, 405, '20.00'),
  text(1, 680, 550, '1,09,980.00'),
];

type Read = (bytes: Uint8Array, password: string) => Promise<PdfTextItem[]>;

async function render(read: Read) {
  const api = fakeApi({ transactions: () => Promise.resolve(PENDING) });
  const reader = { read: vi.fn(read) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: PdfReader, useValue: reader },
      provideRouter([]),
    ],
  });
  const fixture = TestBed.createComponent(ImportScreen);
  await fixture.whenStable();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const select = async (id: string, value: string): Promise<void> => {
    const el = query(root, id) as HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event('change'));
    await settle();
  };
  const attachPdf = async (name = 'statement.pdf'): Promise<void> => {
    const input = query(root, '#imp-file') as HTMLInputElement;
    const file = {
      name,
      type: 'application/pdf',
      arrayBuffer: () => Promise.resolve(new Uint8Array([37, 80, 68, 70]).buffer),
    };
    Object.defineProperty(input, 'files', {
      value: { item: (n: number) => (n === 0 ? file : null), length: 1 },
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await settle();
  };
  const password = (): HTMLInputElement => query(root, '#imp-pdf-password') as HTMLInputElement;
  const open = (): HTMLButtonElement =>
    must(
      [...root.querySelectorAll<HTMLButtonElement>('.pdf button')].find((b) =>
        b.textContent.includes('Open the PDF'),
      ),
      'the Open the PDF button',
    );
  return { api, reader, fixture, root, settle, select, attachPdf, password, open };
}

const words = (el: Element): string => el.textContent.replace(/\s+/g, ' ').trim();

describe('Import screen: PDF statements', () => {
  it('shows a password box only once a PDF is chosen, and the box is a real password field', async () => {
    const { root, attachPdf, password } = await render(() => Promise.resolve(STATEMENT));
    expect(root.querySelector('#imp-pdf-password')).toBeNull();
    await attachPdf();
    expect(words(query(root, '.pdf'))).toContain('PDF chosen: statement.pdf');
    expect(password().type).toBe('password');
    expect(password().autocomplete).toBe('off');
    expect(words(query(root, '.pdf'))).toMatch(/never sent anywhere or saved/);
  });

  it('asks for the layout first, then opens the PDF with the typed password and clears the box', async () => {
    const { reader, root, select, settle, attachPdf, password, open } = await render(() =>
      Promise.resolve(STATEMENT),
    );
    await select('#imp-account', 'acc-bank');
    await attachPdf();
    expect(words(query(root, '.pdf'))).toContain('Choose the statement layout above');
    expect(open().disabled).toBe(true);

    await select('#imp-layout', 'fakebank-savings');
    expect(open().disabled).toBe(false);

    password().value = '12345010190';
    open().click();
    expect(password().value).toBe(''); // emptied at once, not left on the page
    await settle();

    expect(reader.read).toHaveBeenCalledWith(expect.any(Uint8Array), '12345010190');
    expect(words(query(root, '.pdf'))).toContain('Read 1 transaction from 1 page.');
    expect(root.querySelector('#imp-pdf-password')).toBeNull(); // nothing left to type
    expect(words(root)).toContain('Ready: statement.pdf');
    expect((query(root, 'form button[type=submit]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens on Enter in the password box and does not submit the import form', async () => {
    const { api, reader, select, settle, attachPdf, password } = await render(() =>
      Promise.resolve(STATEMENT),
    );
    await select('#imp-account', 'acc-bank');
    await select('#imp-layout', 'fakebank-savings');
    await attachPdf();

    password().value = 'secret';
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    password().dispatchEvent(enter);
    await settle();

    expect(enter.defaultPrevented).toBe(true);
    expect(reader.read).toHaveBeenCalledWith(expect.any(Uint8Array), 'secret');
    expect(api.previewImport).not.toHaveBeenCalled();
  });

  it('imports through the usual preview once the PDF has been read', async () => {
    const { api, root, select, settle, attachPdf, password, open } = await render(() =>
      Promise.resolve(STATEMENT),
    );
    await select('#imp-account', 'acc-bank');
    await select('#imp-layout', 'fakebank-savings');
    await attachPdf();
    password().value = 'x';
    open().click();
    await settle();

    query(root, 'form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(api.previewImport).toHaveBeenCalledTimes(1);
    expect(words(root)).toContain('Nothing has been saved yet.');
  });

  it('says the password was wrong, empties the box and lets you try again', async () => {
    const { root, select, settle, attachPdf, password, open } = await render(() =>
      Promise.reject(new PdfPasswordError('wrong')),
    );
    await select('#imp-layout', 'fakebank-savings');
    await attachPdf();
    password().value = 'hunter2';
    open().click();
    await settle();

    const alert = query(root, '.pdf [role=alert]');
    expect(words(alert)).toBe('That password did not open the PDF. Check it and try again.');
    expect(words(root)).not.toContain('hunter2');
    expect(password().value).toBe('');
    expect(open().disabled).toBe(false);
  });

  it('explains when that bank has no PDF layout yet', async () => {
    const { root, select, attachPdf } = await render(() => Promise.resolve(STATEMENT));
    await select('#imp-layout', 'democard');
    await attachPdf();
    expect(words(query(root, '.pdf [role=alert]'))).toContain('has no PDF version yet');
    expect(root.querySelector('#imp-pdf-password')).toBeNull();
  });

  it('lists why the table could not be read, without echoing any of the PDF', async () => {
    const { root, select, settle, attachPdf, open } = await render(() =>
      Promise.resolve([text(1, 700, 40, 'Account 99887766 of Mr Someone')]),
    );
    await select('#imp-layout', 'fakebank-savings');
    await attachPdf();
    open().click();
    await settle();

    const shown = words(query(root, '.pdf'));
    expect(shown).toMatch(/does not read cleanly with that layout/);
    expect(shown).toMatch(/column titles/);
    expect(shown).not.toMatch(/99887766|Someone/);
    expect(open().disabled).toBe(false); // can be retried, e.g. after picking another layout
  });

  it('shows the file as an unreadable choice when the browser cannot read it', async () => {
    const { root, settle } = await render(() => Promise.resolve(STATEMENT));
    const input = query(root, '#imp-file') as HTMLInputElement;
    const broken = {
      name: 'x.pdf',
      type: 'application/pdf',
      arrayBuffer: () => Promise.reject(new Error('nope')),
    };
    Object.defineProperty(input, 'files', {
      value: { item: () => broken, length: 1 },
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(words(query(root, '.problem'))).toBe('Could not read that file.');
  });
});
