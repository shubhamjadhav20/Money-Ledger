import { TestBed } from '@angular/core/testing';
import { PdfPasswordError, PdfReadError } from '@ledger/core';
import type { PdfJsLike } from '@ledger/core';
import { PDFJS_LOADER, PdfReader } from './pdf-reader';

function fakePdfJs(outcome: 'ok' | 'needs-password' | 'wrong-password' | 'broken'): {
  pdfjs: PdfJsLike;
  options: () => Record<string, unknown> | undefined;
} {
  let seen: Record<string, unknown> | undefined;
  const pdfjs = {
    getDocument: (source: Record<string, unknown>) => {
      seen = source;
      const failure =
        outcome === 'needs-password'
          ? Object.assign(new Error('x'), { name: 'PasswordException', code: 1 })
          : outcome === 'wrong-password'
            ? Object.assign(new Error('x'), { name: 'PasswordException', code: 2 })
            : outcome === 'broken'
              ? Object.assign(new Error('secret'), { name: 'InvalidPDFException' })
              : undefined;
      return {
        promise:
          failure === undefined
            ? Promise.resolve({
                numPages: 1,
                getPage: () =>
                  Promise.resolve({
                    getTextContent: () =>
                      Promise.resolve({
                        items: [
                          { str: 'Date', transform: [8, 0, 0, 8, 40, 700], width: 20, height: 8 },
                        ],
                      }),
                  }),
              })
            : Promise.reject(failure),
        destroy: () => Promise.resolve(),
      };
    },
  } as unknown as PdfJsLike;
  return { pdfjs, options: () => seen };
}

function setup(pdfjs: PdfJsLike) {
  const loader = vi.fn(() => Promise.resolve(pdfjs));
  TestBed.configureTestingModule({ providers: [{ provide: PDFJS_LOADER, useValue: loader }] });
  return { loader, reader: TestBed.inject(PdfReader) };
}

const bytes = new Uint8Array([37, 80, 68, 70]);

describe('PdfReader', () => {
  it('does not load pdf.js until a PDF is opened', () => {
    const { loader } = setup(fakePdfJs('ok').pdfjs);
    expect(loader).not.toHaveBeenCalled();
  });

  it('returns the positioned text of the PDF', async () => {
    const { reader, loader } = setup(fakePdfJs('ok').pdfjs);
    expect(await reader.read(bytes, '')).toEqual([
      { page: 1, x: 40, y: 700, width: 20, height: 8, text: 'Date' },
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('hands the password to pdf.js and opens documents without code execution', async () => {
    const fake = fakePdfJs('ok');
    const { reader } = setup(fake.pdfjs);
    await reader.read(bytes, 'hunter2');
    expect(fake.options()).toMatchObject({
      password: 'hunter2',
      isEvalSupported: false,
      enableXfa: false,
    });
  });

  it('says a password is needed, or wrong, without echoing it', async () => {
    const needed = await setup(fakePdfJs('needs-password').pdfjs)
      .reader.read(bytes, '')
      .catch((e: unknown) => e);
    expect(needed).toBeInstanceOf(PdfPasswordError);
    expect((needed as PdfPasswordError).reason).toBe('needed');

    TestBed.resetTestingModule();
    const wrong = await setup(fakePdfJs('wrong-password').pdfjs)
      .reader.read(bytes, 'hunter2')
      .catch((e: unknown) => e);
    expect((wrong as PdfPasswordError).reason).toBe('wrong');
    expect((wrong as Error).message).not.toContain('hunter2');
  });

  it('turns any other failure into a fixed, safe message', async () => {
    const error = await setup(fakePdfJs('broken').pdfjs)
      .reader.read(bytes, '')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfReadError);
    expect((error as Error).message).not.toContain('secret');
  });
});
