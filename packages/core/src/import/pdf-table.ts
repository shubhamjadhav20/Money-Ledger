/**
 * Turns the positioned text of a PDF bank statement into the same CSV a bank's CSV export would be,
 * so the existing preview/confirm import (and its tests) handle it unchanged. Pure: no PDF library
 * here. A reader (browser or Node) supplies `PdfTextItem`s; this rebuilds the table from geometry.
 *
 * Method: group items into lines, find the line holding the column titles, assign every later cell
 * to the title it sits under, start a row at each line whose date cell parses, and glue wrapped
 * narration lines to the row above. It never guesses: a line it cannot place becomes an issue, not a
 * dropped or "fixed" transaction, because a silently lost line is a silently wrong balance.
 */
import { DateError, parseLocalDate } from '../dates.ts';
import { formatCsvRecord } from './csv.ts';
import { mappingColumns } from './csv-importer.ts';
import { normaliseCounterparty } from './identity.ts';
import type { CsvMapping, ParseIssue } from './types.ts';

/** One run of text with its place on a page. PDF units (points); y grows upward. */
export interface PdfTextItem {
  /** 1-based. */
  readonly page: number;
  /** Left edge. */
  readonly x: number;
  /** Baseline. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
}

export interface PdfColumn {
  /** The column title as printed (case, spacing and punctuation are ignored when matching). */
  readonly label: string;
  /** The CSV column this feeds, when the PDF prints it differently. Default: the label. */
  readonly as?: string;
}

export interface PdfLayout {
  readonly id: string;
  readonly label: string;
  /** The CSV layout the rebuilt table is read with. Its column names are the `as ?? label` names. */
  readonly mapping: CsvMapping;
  /** Left to right, as printed. */
  readonly columns: readonly PdfColumn[];
  /** Columns that wrap onto a second line (names as in the CSV), usually just the narration. */
  readonly continuationColumns: readonly string[];
  /**
   * How a wrapped line is joined to the one above: with a space (default; no space after a trailing
   * "/"), or with none, for banks that wrap at a fixed width, even in the middle of a word.
   */
  readonly continuationJoin?: 'space' | 'none';
  /** Lines that start with one of these (ignoring case) are page furniture, e.g. "Page 1 of 3". */
  readonly ignoreLines?: readonly string[];
  /** A line starting with one of these ends the table, e.g. "End of Statement". */
  readonly endMarkers?: readonly string[];
}

export interface PdfTableResult {
  /** Header plus one line per transaction; empty when the column titles were not found. */
  readonly csv: string;
  readonly rowCount: number;
  readonly issues: ParseIssue[];
}

/** Used when an item reports no height. */
const DEFAULT_HEIGHT = 8;
/** Items closer than this fraction of the text height vertically are on one line. */
const LINE_TOLERANCE = 0.4;
/** Items closer than this (as a fraction of text height) horizontally form one cell. */
const MERGE_GAP = 0.35;
/** ...and get a space between them when further apart than this. */
const SPACE_GAP = 0.08;
/** A wrapped line sits within this many text heights below the line above it. */
const ATTACH_LIMIT = 2.5;
/** Left edges may sit this many points left of their title and still belong to it. */
const EDGE_TOLERANCE = 2;
/** A column title printed as several separate words. */
const MAX_TITLE_CELLS = 4;

const NUMERIC = /^[\d.,()+\s-]+(?:cr|dr)?$/iu;
const DATE_LIKE = /^\d{1,2}[-/. ][\p{L}\d]{1,3}[-/. ]\d{2,4}$/u;

const columnName = (column: PdfColumn): string => column.as ?? column.label;

function joinWrapped(previous: string, next: string, how: PdfLayout['continuationJoin']): string {
  if (previous === '') return next;
  return how === 'none' || previous.endsWith('/') ? previous + next : `${previous} ${next}`;
}
const same = (a: string, b: string): boolean =>
  normaliseCounterparty(a) === normaliseCounterparty(b);

interface Cell {
  x: number;
  right: number;
  text: string;
}
interface Line {
  readonly page: number;
  readonly y: number;
  readonly height: number;
  readonly cells: Cell[];
}
interface Anchor {
  readonly left: number;
  readonly right: number;
}

function mergeCells(items: readonly PdfTextItem[], height: number): Cell[] {
  const cells: Cell[] = [];
  for (const item of [...items].sort((a, b) => a.x - b.x)) {
    const previous = cells.at(-1);
    const gap = previous === undefined ? Infinity : item.x - previous.right;
    if (previous !== undefined && gap <= MERGE_GAP * height) {
      previous.text += (gap > SPACE_GAP * height ? ' ' : '') + item.text;
      previous.right = Math.max(previous.right, item.x + item.width);
    } else {
      cells.push({ x: item.x, right: item.x + item.width, text: item.text });
    }
  }
  return cells;
}

function buildLines(items: readonly PdfTextItem[]): Line[] {
  const usable = items
    .filter((item) => item.text.trim() !== '')
    .map((item) => ({ ...item, text: item.text.trim() }))
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

  const groups: { page: number; y: number; height: number; items: PdfTextItem[] }[] = [];
  for (const item of usable) {
    const height = item.height > 0 ? item.height : DEFAULT_HEIGHT;
    const last = groups.at(-1);
    if (
      last?.page === item.page &&
      last.y - item.y <= LINE_TOLERANCE * Math.max(height, last.height)
    ) {
      last.items.push(item);
    } else {
      groups.push({ page: item.page, y: item.y, height, items: [item] });
    }
  }
  return groups.map((g) => ({
    page: g.page,
    y: g.y,
    height: g.height,
    cells: mergeCells(g.items, g.height),
  }));
}

/** The place of every column title on this line, or undefined if any title is missing. */
function locateTitles(line: Line, columns: readonly PdfColumn[]): Anchor[] | undefined {
  const anchors: Anchor[] = [];
  let from = 0;
  for (const column of columns) {
    let found: { anchor: Anchor; next: number } | undefined;
    for (let start = from; start < line.cells.length && found === undefined; start++) {
      for (let length = 1; length <= MAX_TITLE_CELLS; length++) {
        const slice = line.cells.slice(start, start + length);
        const first = slice[0];
        const last = slice.at(-1);
        if (first === undefined || last === undefined) break;
        if (same(slice.map((c) => c.text).join(' '), column.label)) {
          found = { anchor: { left: first.x, right: last.right }, next: start + length };
          break;
        }
      }
    }
    if (found === undefined) return undefined;
    anchors.push(found.anchor);
    from = found.next;
  }
  return anchors;
}

/**
 * Numbers (usually right-aligned) go to the title they overlap most; text goes to the last title
 * whose left edge is at or before it, so a long narration never drifts into the next column.
 */
function columnFor(cell: Cell, anchors: readonly Anchor[]): number {
  if (NUMERIC.test(cell.text)) {
    let best = -1;
    let bestOverlap = 0;
    anchors.forEach((anchor, index) => {
      const overlap = Math.min(cell.right, anchor.right) - Math.max(cell.x, anchor.left);
      if (overlap > bestOverlap) {
        best = index;
        bestOverlap = overlap;
      }
    });
    if (best >= 0) return best;
  }
  let chosen = 0;
  anchors.forEach((anchor, index) => {
    if (anchor.left <= cell.x + EDGE_TOLERANCE) chosen = index;
  });
  return chosen;
}

/** Problems with the layout itself (a programming error, not a bad file). */
export function validatePdfLayout(layout: PdfLayout): string[] {
  const errors: string[] = [];
  if (layout.columns.length === 0) errors.push('The layout has no columns');
  const names = layout.columns.map((c) => normaliseCounterparty(columnName(c)));
  const titles = layout.columns.map((c) => normaliseCounterparty(c.label));
  if (new Set(names).size !== names.length) errors.push('Two columns have the same name');
  if (new Set(titles).size !== titles.length) errors.push('Two columns have the same title');
  for (const needed of mappingColumns(layout.mapping)) {
    if (!names.includes(normaliseCounterparty(needed))) {
      errors.push(`The CSV layout reads a column called "${needed}" that no PDF column supplies`);
    }
  }
  for (const name of layout.continuationColumns) {
    if (!names.includes(normaliseCounterparty(name))) {
      errors.push(`Continuation column "${name}" is not one of the columns`);
    }
  }
  return errors;
}

function parsesAsDate(text: string, mapping: CsvMapping): boolean {
  try {
    parseLocalDate(text, mapping.dateFormat);
    return true;
  } catch (error) {
    if (error instanceof DateError) return false;
    throw error;
  }
}

export function pdfTableToCsv(items: readonly PdfTextItem[], layout: PdfLayout): PdfTableResult {
  const problems = validatePdfLayout(layout);
  if (problems.length > 0) throw new Error(`Invalid PDF layout: ${problems.join('; ')}`);

  const names = layout.columns.map(columnName);
  const dateIndex = names.findIndex((name) => same(name, layout.mapping.dateColumn));
  const continuation = new Set(layout.continuationColumns.map(normaliseCounterparty));
  const isContinuation = (index: number): boolean =>
    continuation.has(normaliseCounterparty(names[index] ?? ''));
  const ends = (layout.endMarkers ?? []).map(normaliseCounterparty).filter((m) => m !== '');
  const ignores = (layout.ignoreLines ?? []).map(normaliseCounterparty).filter((m) => m !== '');

  const issues: ParseIssue[] = [];
  const rows: string[][] = [];
  let anchors: Anchor[] | undefined;
  let current: string[] | undefined;
  let last: { page: number; y: number } | undefined;
  let page = 0;
  let preamble = false; // top of a page, before its titles or its first row: furniture lives here

  for (const line of buildLines(items)) {
    if (line.page !== page) {
      page = line.page;
      preamble = true;
    }
    const titles = locateTitles(line, layout.columns);
    if (titles !== undefined) {
      anchors = titles;
      preamble = false;
      continue;
    }
    if (anchors === undefined) continue;

    const texts = names.map(() => '');
    for (const cell of line.cells) {
      const index = columnFor(cell, anchors);
      texts[index] = `${texts[index] ?? ''} ${cell.text}`.trim();
    }
    const dateText = texts[dateIndex] ?? '';
    const lineText = normaliseCounterparty(line.cells.map((c) => c.text).join(' '));

    if (parsesAsDate(dateText, layout.mapping)) {
      preamble = false;
      if (current !== undefined) rows.push(current);
      current = texts;
      last = { page: line.page, y: line.y };
      continue;
    }

    if (ends.some((marker) => lineText.startsWith(marker))) break;
    if (ignores.some((marker) => lineText.startsWith(marker))) continue;
    if (preamble) continue;

    if (DATE_LIKE.test(dateText)) {
      issues.push({
        line: 0,
        reason: `Page ${String(line.page)}: a line starts with a date that cannot be read.`,
      });
      continue;
    }
    if (current === undefined) continue; // e.g. an opening balance above the first transaction

    const populated = texts.flatMap((text, index) => (text === '' ? [] : [index]));
    const attached = last?.page === line.page && last.y - line.y <= ATTACH_LIMIT * line.height;

    if (attached && populated.every(isContinuation)) {
      for (const index of populated) {
        current[index] = joinWrapped(
          current[index] ?? '',
          texts[index] ?? '',
          layout.continuationJoin,
        );
      }
      last = { page: line.page, y: line.y };
    } else if (attached || line.cells.some((cell) => NUMERIC.test(cell.text))) {
      issues.push({
        line: 0,
        reason: `Page ${String(line.page)}: text near a transaction does not fit any column of the layout.`,
      });
    }
    // Anything else is detached prose (a footer, a disclaimer) and is left out on purpose.
  }
  if (current !== undefined) rows.push(current);

  if (anchors === undefined) {
    const wanted = layout.columns.map((c) => c.label).join(', ');
    return {
      csv: '',
      rowCount: 0,
      issues: [
        {
          line: 0,
          reason: `Could not find the column titles (${wanted}) in this PDF. Is this the right layout?`,
        },
      ],
    };
  }
  if (rows.length === 0) {
    issues.push({
      line: 0,
      reason: 'The column titles were found, but no transactions below them.',
    });
  }

  const csv = [names, ...rows].map((fields) => formatCsvRecord(fields)).join('\n') + '\n';
  return { csv, rowCount: rows.length, issues };
}
