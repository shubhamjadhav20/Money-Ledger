import { Injectable, InjectionToken, inject } from '@angular/core';
import { readPdfTextItems } from '@ledger/core';
import type { PdfJsLike, PdfTextItem } from '@ledger/core';

/**
 * Where the pdf.js worker is served from. angular.json copies it out of `pdfjs-dist` into the
 * build, so it comes from this app's own origin (nothing is fetched from a CDN).
 */
export const PDF_WORKER_PATH = 'pdfjs/pdf.worker.min.mjs';

let loaded: Promise<PdfJsLike> | undefined;

/**
 * pdf.js is large, so it is fetched only when a PDF is actually opened, and only once. A failed
 * load is forgotten so the next attempt can try again.
 */
export function loadPdfJs(): Promise<PdfJsLike> {
  if (loaded === undefined) {
    const promise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(PDF_WORKER_PATH, document.baseURI).href;
      return pdfjs;
    });
    void promise.catch(() => {
      if (loaded === promise) loaded = undefined;
    });
    loaded = promise;
  }
  return loaded;
}

/** How pdf.js is obtained. Tests replace it so the real library is never loaded. */
export const PDFJS_LOADER = new InjectionToken<() => Promise<PdfJsLike>>('PDFJS_LOADER', {
  providedIn: 'root',
  factory: () => loadPdfJs,
});

/**
 * Opens a PDF in this browser and returns its positioned text. The password stays in this call:
 * it is handed to pdf.js and not kept. Throws `PdfPasswordError` or `PdfReadError` (from core).
 */
@Injectable({ providedIn: 'root' })
export class PdfReader {
  private readonly load = inject(PDFJS_LOADER);

  async read(bytes: Uint8Array, password: string): Promise<PdfTextItem[]> {
    return readPdfTextItems(await this.load(), bytes, password);
  }
}
