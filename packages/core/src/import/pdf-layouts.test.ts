import { describe, expect, it } from 'vitest';
import { DEMO_MAPPINGS } from './demo-mappings.ts';
import { PDF_LAYOUTS, pdfLayoutFor } from './pdf-layouts.ts';
import { validatePdfLayout } from './pdf-table.ts';

describe('PDF_LAYOUTS', () => {
  it.each(PDF_LAYOUTS.map((layout) => [layout.id, layout] as const))(
    '%s is a valid layout for a known CSV layout',
    (_id, layout) => {
      expect(validatePdfLayout(layout)).toEqual([]);
      expect(DEMO_MAPPINGS.map((m) => m.id)).toContain(layout.mapping.id);
    },
  );

  it('has unique ids', () => {
    const ids = PDF_LAYOUTS.map((layout) => layout.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds the PDF layout by CSV layout id, or nothing', () => {
    expect(pdfLayoutFor('fakebank-savings')?.id).toBe('fakebank-savings-pdf');
    expect(pdfLayoutFor('democard')).toBeUndefined();
  });
});
