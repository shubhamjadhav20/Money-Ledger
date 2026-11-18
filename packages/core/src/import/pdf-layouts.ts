/**
 * PDF statement layouts. Each one pairs a bank's CSV layout (what the server reads) with how the
 * same table is printed in that bank's PDF. Config only: a real bank is added here, never with a
 * real statement in the repository. Only the column titles, never any data, belong in this file.
 */
import { FAKEBANK_SAVINGS } from './demo-mappings.ts';
import type { PdfLayout } from './pdf-table.ts';

/** The fake demo bank: the PDF printed by the fixture generator. */
export const FAKEBANK_SAVINGS_PDF: PdfLayout = {
  id: 'fakebank-savings-pdf',
  label: 'FakeBank savings (demo PDF)',
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

export const PDF_LAYOUTS: readonly PdfLayout[] = [FAKEBANK_SAVINGS_PDF];

/** The PDF layout for a CSV layout id, if that bank's PDF is supported. */
export function pdfLayoutFor(mappingId: string): PdfLayout | undefined {
  return PDF_LAYOUTS.find((layout) => layout.mapping.id === mappingId);
}
