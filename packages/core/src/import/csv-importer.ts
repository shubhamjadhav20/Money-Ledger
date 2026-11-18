import { DateError, parseLocalDate } from '../dates.ts';
import { MoneyError, negatePaise, parseAmount } from '../money.ts';
import type { Paise } from '../money.ts';
import { CsvError, parseCsv } from './csv.ts';
import type { CsvRecord } from './csv.ts';
import type { CsvMapping, ImportSource, ParseIssue, ParseResult, RawRow } from './types.ts';

const norm = (s: string): string => s.trim().toLowerCase();

/** Every column name the mapping reads, in the file's own spelling. */
export function mappingColumns(m: CsvMapping): string[] {
  const a = m.amount;
  const amountColumns =
    a.kind === 'signed'
      ? [a.column]
      : a.kind === 'debitCredit'
        ? [a.debitColumn, a.creditColumn]
        : [a.amountColumn, a.typeColumn];
  return [
    m.dateColumn,
    m.counterpartyColumn,
    ...amountColumns,
    ...(m.refColumn === undefined ? [] : [m.refColumn]),
    ...(m.memoColumns ?? []),
  ];
}

/** A problem with one row; becomes a ParseIssue for that line. */
class RowError extends Error {
  override name = 'RowError';
}

function readAmount(m: CsvMapping, cell: (column: string) => string): Paise {
  const a = m.amount;
  if (a.kind === 'signed') return parseAmount(cell(a.column));

  if (a.kind === 'debitCredit') {
    const debitText = cell(a.debitColumn);
    const creditText = cell(a.creditColumn);
    const debit = debitText === '' ? 0 : parseAmount(debitText);
    const credit = creditText === '' ? 0 : parseAmount(creditText);
    if (debit !== 0 && credit !== 0) throw new RowError('Both debit and credit are filled');
    if (debit === 0 && credit === 0) throw new RowError('Neither debit nor credit is filled');
    return debit !== 0 ? negatePaise(parseAmount(debitText)) : parseAmount(creditText);
  }

  const amount = parseAmount(cell(a.amountColumn));
  const type = norm(cell(a.typeColumn));
  if (a.debitMarkers.some((x) => norm(x) === type)) return negatePaise(amount);
  if (a.creditMarkers.some((x) => norm(x) === type)) return amount;
  throw new RowError(`Unknown debit/credit marker ${JSON.stringify(cell(a.typeColumn))}`);
}

function parseRecords(mapping: CsvMapping, records: CsvRecord[]): ParseResult {
  const required = mappingColumns(mapping).map(norm);
  const header = records.find((r) => {
    const names = r.fields.map(norm);
    return required.every((c) => names.includes(c));
  });
  if (header === undefined) {
    const expected = mappingColumns(mapping).join(', ');
    return {
      rows: [],
      issues: [{ line: 0, reason: `Header row not found (expected: ${expected})` }],
    };
  }
  const columnIndex = new Map(header.fields.map((name, index) => [norm(name), index]));

  const rows: RawRow[] = [];
  const issues: ParseIssue[] = [];

  for (const record of records.slice(records.indexOf(header) + 1)) {
    if (record.fields.every((f) => f.trim() === '')) continue;
    const first = record.fields[0]?.trim() ?? '';
    if (mapping.footerMarkers?.some((marker) => first.startsWith(marker)) === true) break;

    if (record.fields.length < header.fields.length) {
      const reason = `Expected ${String(header.fields.length)} columns, got ${String(record.fields.length)}`;
      issues.push({ line: record.line, reason });
      continue;
    }
    const cell = (column: string): string =>
      record.fields[columnIndex.get(norm(column)) ?? -1]?.trim() ?? '';

    try {
      const ref = mapping.refColumn === undefined ? '' : cell(mapping.refColumn);
      const memo = (mapping.memoColumns ?? [])
        .map(cell)
        .filter((s) => s !== '')
        .join(' | ');
      rows.push({
        line: record.line,
        date: parseLocalDate(cell(mapping.dateColumn), mapping.dateFormat),
        amount: readAmount(mapping, cell),
        counterparty: cell(mapping.counterpartyColumn),
        memo,
        ...(ref === '' ? {} : { ref }),
      });
    } catch (error) {
      if (error instanceof RowError || error instanceof MoneyError || error instanceof DateError) {
        issues.push({ line: record.line, reason: error.message });
        continue;
      }
      throw error;
    }
  }
  return { rows, issues };
}

/**
 * CSV statement importer for one bank layout. Never guesses: a row it cannot read exactly
 * becomes an issue for the preview screen, not a silently dropped or "fixed" transaction.
 */
export function createCsvImporter(mapping: CsvMapping): ImportSource {
  return {
    id: mapping.id,
    parse(text: string): ParseResult {
      let records: CsvRecord[];
      try {
        records = parseCsv(text, mapping.delimiter);
      } catch (error) {
        if (error instanceof CsvError)
          return { rows: [], issues: [{ line: 0, reason: error.message }] };
        throw error;
      }
      return parseRecords(mapping, records);
    },
  };
}
