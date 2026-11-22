/** Minimal RFC 4180 CSV parser. Pure: takes text, returns records with their starting line. */

export interface CsvRecord {
  /** 1-based line where the record starts (for error messages). */
  readonly line: number;
  readonly fields: string[];
}

export class CsvError extends Error {
  override name = 'CsvError';
}

export function parseCsv(input: string, delimiter = ','): CsvRecord[] {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let i = 0;

  const endRecord = (): void => {
    fields.push(field);
    records.push({ line: recordLine, fields });
    fields = [];
    field = '';
  };

  while (i < text.length) {
    const ch = text.charAt(i);

    if (ch === '"' && field === '') {
      // Quoted field: read until the closing quote; "" is an escaped quote.
      const openedAt = line;
      i++;
      for (;;) {
        if (i >= text.length)
          throw new CsvError(`Unterminated quote starting on line ${String(openedAt)}`);
        const q = text.charAt(i);
        if (q === '"') {
          if (text.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (q === '\n' || (q === '\r' && text.charAt(i + 1) !== '\n')) line++;
        field += q;
        i++;
      }
      const next = text.charAt(i);
      if (i < text.length && next !== delimiter && next !== '\n' && next !== '\r') {
        throw new CsvError(`Unexpected text after closing quote on line ${String(line)}`);
      }
      continue;
    }

    if (ch === delimiter) {
      fields.push(field);
      field = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      endRecord();
      i += ch === '\r' && text.charAt(i + 1) === '\n' ? 2 : 1;
      line++;
      recordLine = line;
    } else {
      field += ch;
      i++;
    }
  }

  // Final record, unless the input ended with a newline.
  if (field !== '' || fields.length > 0) endRecord();
  return records;
}

/** One CSV line for `fields`: quoted only when needed. The inverse of what parseCsv reads. */
export function formatCsvRecord(fields: readonly string[], delimiter = ','): string {
  return fields
    .map((field) =>
      field.includes(delimiter) || /["\r\n]/u.test(field)
        ? `"${field.replaceAll('"', '""')}"`
        : field,
    )
    .join(delimiter);
}
