import { describe, expect, it, vi } from 'vitest';
import { MAX_PDF_PAGES, PdfPasswordError, PdfReadError, readPdfTextItems } from './pdf-extract.ts';
import type { PdfJsLike } from './pdf-extract.ts';

type Content = readonly unknown[];

function fakePdfJs(pages: readonly Content[]): {
  pdfjs: PdfJsLike;
  getDocument: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  const destroy = vi.fn(() => Promise.resolve());
  const getDocument = vi.fn((options: Record<string, unknown>) => ({
    options,
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: (n: number) =>
        Promise.resolve({
          getTextContent: () => Promise.resolve({ items: pages[n - 1] ?? [] }),
        }),
    }),
    destroy,
  }));
  return { pdfjs: { getDocument }, getDocument, destroy };
}

const run = (str: string, x: number, y: number, size = 9, width = str.length * 5): unknown => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});

const bytes = new Uint8Array([37, 80, 68, 70]);

describe('readPdfTextItems()', () => {
  it('turns pdf.js text runs into positioned items, page by page', async () => {
    const { pdfjs } = fakePdfJs([
      [run('Date', 40, 700), run('Narration', 110, 700)],
      [run('Page two', 40, 500)],
    ]);
    expect(await readPdfTextItems(pdfjs, bytes, '')).toEqual([
      { page: 1, x: 40, y: 700, width: 20, height: 9, text: 'Date' },
      { page: 1, x: 110, y: 700, width: 45, height: 9, text: 'Narration' },
      { page: 2, x: 40, y: 500, width: 40, height: 9, text: 'Page two' },
    ]);
  });

  it('skips marked-content markers, malformed runs and empty text', async () => {
    const { pdfjs } = fakePdfJs([
      [
        { type: 'beginMarkedContent', id: 'x' },
        { str: 'no transform' },
        { str: 42, transform: [1, 0, 0, 1, 0, 0] },
        run('   ', 10, 10),
        run('kept', 10, 20),
        { type: 'endMarkedContent' },
      ],
    ]);
    const items = await readPdfTextItems(pdfjs, bytes, '');
    expect(items.map((i) => i.text)).toEqual(['kept']);
  });

  it('falls back to the font size when a run reports no height', async () => {
    const { pdfjs } = fakePdfJs([
      [{ str: 'x', transform: [0, 0, 0, 11, 5, 6], width: 5, height: 0 }],
    ]);
    expect((await readPdfTextItems(pdfjs, bytes, ''))[0]?.height).toBe(11);
  });

  it('opens the document without code execution or XFA, and only sends a password when given', async () => {
    const withPassword = fakePdfJs([[run('a', 1, 1)]]);
    await readPdfTextItems(withPassword.pdfjs, bytes, 's3cret');
    const options = withPassword.getDocument.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options['password']).toBe('s3cret');
    expect(options['isEvalSupported']).toBe(false);
    expect(options['enableXfa']).toBe(false);

    const without = fakePdfJs([[run('a', 1, 1)]]);
    await readPdfTextItems(without.pdfjs, bytes, '');
    expect(
      Object.hasOwn(without.getDocument.mock.calls[0]?.[0] as Record<string, unknown>, 'password'),
    ).toBe(false);
  });

  it('hands pdf.js its own copy so the caller keeps the bytes', async () => {
    const { pdfjs, getDocument } = fakePdfJs([[run('a', 1, 1)]]);
    await readPdfTextItems(pdfjs, bytes, '');
    const given = (getDocument.mock.calls[0]?.[0] as { data: Uint8Array }).data;
    expect(given).not.toBe(bytes);
    expect([...given]).toEqual([...bytes]);
    expect(Object.getPrototypeOf(given)).toBe(Uint8Array.prototype);
  });

  it('accepts a Uint8Array subclass (such as a Node Buffer), which pdf.js itself would refuse', async () => {
    class Subclassed extends Uint8Array {}
    const { pdfjs, getDocument } = fakePdfJs([[run('a', 1, 1)]]);
    await readPdfTextItems(pdfjs, new Subclassed([37, 80, 68, 70]), '');
    const given = (getDocument.mock.calls[0]?.[0] as { data: Uint8Array }).data;
    expect(Object.getPrototypeOf(given)).toBe(Uint8Array.prototype);
  });

  it('always releases the document, on success and on failure', async () => {
    const ok = fakePdfJs([[run('a', 1, 1)]]);
    await readPdfTextItems(ok.pdfjs, bytes, '');
    expect(ok.destroy).toHaveBeenCalledTimes(1);

    const tooMany = fakePdfJs(Array.from({ length: MAX_PDF_PAGES + 1 }, () => []));
    await expect(readPdfTextItems(tooMany.pdfjs, bytes, '')).rejects.toBeInstanceOf(PdfReadError);
    expect(tooMany.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    [1, 'needed'],
    [2, 'wrong'],
  ])('maps pdf.js password code %d to a PdfPasswordError (%s)', async (code, reason) => {
    const pdfjs = {
      getDocument: () => ({
        promise: Promise.reject(
          Object.assign(new Error('No password given'), { name: 'PasswordException', code }),
        ),
        destroy: () => Promise.resolve(),
      }),
    } as unknown as PdfJsLike;
    const error = await readPdfTextItems(pdfjs, bytes, 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfPasswordError);
    expect((error as PdfPasswordError).reason).toBe(reason);
  });

  it('maps any other pdf.js failure to a PdfReadError that does not echo the cause', async () => {
    const pdfjs = {
      getDocument: () => ({
        promise: Promise.reject(
          Object.assign(new Error('secret detail 12345'), { name: 'InvalidPDFException' }),
        ),
        destroy: () => Promise.resolve(),
      }),
    } as unknown as PdfJsLike;
    const error = await readPdfTextItems(pdfjs, bytes, '').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfReadError);
    expect((error as Error).message).not.toMatch(/secret|12345/);
  });

  it('refuses an absurd amount of text', async () => {
    const many = Array.from({ length: 5 }, (_, i) => run('x', i, i));
    const { pdfjs } = fakePdfJs([many]);
    await expect(readPdfTextItems(pdfjs, bytes, '', { maxItems: 3 })).rejects.toBeInstanceOf(
      PdfReadError,
    );
  });
});
