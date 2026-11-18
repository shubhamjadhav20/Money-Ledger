/**
 * Reads positioned text out of a PDF through pdf.js, without core depending on it: the caller passes
 * the library in (the browser's lazily loaded copy, or Node's in tests and tools). Only the parts of
 * the library used here are described, so a stub can stand in for it.
 *
 * Safety: the PDF is untrusted input. Code execution (`eval`) and XFA forms are switched off, page
 * and text counts are capped, and a failure never carries the library's own message (it can quote
 * file content) or the password.
 */
import type { PdfTextItem } from './pdf-table.ts';

/** The slice of pdf.js this module uses. */
export interface PdfJsLike {
  getDocument(source: Record<string, unknown>): {
    readonly promise: Promise<PdfJsDocument>;
    destroy(): Promise<void>;
  };
}
export interface PdfJsDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
}
export interface PdfJsPage {
  getTextContent(): Promise<{ readonly items: readonly unknown[] }>;
}

export const MAX_PDF_PAGES = 100;
export const MAX_PDF_ITEMS = 250_000;

/** The file is encrypted and the password was missing or did not open it. */
export class PdfPasswordError extends Error {
  override name = 'PdfPasswordError';
  readonly reason: 'needed' | 'wrong';
  constructor(reason: 'needed' | 'wrong') {
    super(reason === 'needed' ? 'This PDF needs a password' : 'That password did not open the PDF');
    this.reason = reason;
  }
}

/** Anything else that stops the PDF being read. The message is safe to show. */
export class PdfReadError extends Error {
  override name = 'PdfReadError';
}

interface RawRun {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width?: number;
  readonly height?: number;
}

function isRun(value: unknown): value is RawRun {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run['str'] === 'string' &&
    Array.isArray(run['transform']) &&
    run['transform'].length >= 6 &&
    run['transform'].every((n) => typeof n === 'number')
  );
}

/** pdf.js PasswordResponses.INCORRECT_PASSWORD (NEED_PASSWORD is 1). */
const PASSWORD_WRONG = 2;

function translate(error: unknown): Error {
  if (error instanceof PdfReadError || error instanceof PdfPasswordError) return error;
  if (typeof error === 'object' && error !== null) {
    const { name, code } = error as { name?: unknown; code?: unknown };
    if (name === 'PasswordException') {
      return new PdfPasswordError(code === PASSWORD_WRONG ? 'wrong' : 'needed');
    }
  }
  return new PdfReadError('That file could not be read as a PDF.');
}

export interface ReadPdfOptions {
  readonly maxPages?: number;
  readonly maxItems?: number;
}

/** Every text run of every page, in the library's own order. `password` may be empty. */
export async function readPdfTextItems(
  pdfjs: PdfJsLike,
  data: Uint8Array,
  password: string,
  options: ReadPdfOptions = {},
): Promise<PdfTextItem[]> {
  const maxPages = options.maxPages ?? MAX_PDF_PAGES;
  const maxItems = options.maxItems ?? MAX_PDF_ITEMS;
  const task = pdfjs.getDocument({
    data: data.slice(), // pdf.js takes ownership of the buffer it is given
    ...(password === '' ? {} : { password }),
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
  });

  try {
    const document = await task.promise;
    if (document.numPages > maxPages) {
      throw new PdfReadError(
        `That PDF has more than ${String(maxPages)} pages, which is too many for a statement.`,
      );
    }
    const items: PdfTextItem[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      for (const run of content.items) {
        if (!isRun(run)) continue;
        const text = run.str.trim();
        if (text === '') continue;
        const [, , , scaleY = 0, x = 0, y = 0] = run.transform;
        items.push({
          page,
          x,
          y,
          width: run.width ?? 0,
          height: run.height !== undefined && run.height > 0 ? run.height : Math.abs(scaleY),
          text,
        });
        if (items.length > maxItems)
          throw new PdfReadError('That PDF has too much text to be a statement.');
      }
    }
    return items;
  } catch (error) {
    throw translate(error);
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
