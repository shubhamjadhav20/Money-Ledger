/**
 * A privacy-safe picture of a PDF statement's structure, for building a bank layout without anyone
 * sharing a statement. Every letter becomes x/X and every digit 9, so names, narrations and amounts
 * vanish while the shape stays: where columns sit, how dates and amounts are formatted, which lines
 * repeat on every page. The reader chooses which few lines (normally just the column titles) to show
 * as printed.
 */
import type { PdfLine } from '../../packages/core/src/index.ts';

const MAX_SELECTION = 1000;

/** Letters -> x (X for upper case), digits -> 9; everything else is kept. */
export function maskText(text: string): string {
  return Array.from(text)
    .map((ch) => {
      if (/\p{Lu}/u.test(ch)) return 'X';
      if (/\p{L}/u.test(ch)) return 'x';
      if (/\p{N}/u.test(ch)) return '9';
      return ch;
    })
    .join('');
}

/** "14", "3,5-7": the 1-based line numbers to show as printed. */
export function parseLineSelection(spec: string): Set<number> {
  const chosen = new Set<number>();
  if (spec.trim() === '') return chosen;
  for (const part of spec.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/u.exec(part);
    const from = Number(match?.[1]);
    const to = match?.[2] === undefined ? from : Number(match[2]);
    if (match === null || from < 1 || to < from || to - from >= MAX_SELECTION) {
      throw new Error(`"${part.trim()}" is not a line number or a range such as 14 or 12-15`);
    }
    for (let n = from; n <= to; n++) chosen.add(n);
  }
  return chosen;
}

const f1 = (n: number): string => n.toFixed(1);
const lineLabel = (n: number, revealed: boolean): string =>
  `L${String(n).padStart(3, '0')}${revealed ? '*' : ' '}`;

/** The shape of a line, independent of its content: used to spot rows repeated on each page. */
const shape = (line: PdfLine): string =>
  line.cells.map((c) => `${maskText(c.text)}@${String(Math.round(c.x))}`).join('|');

export function formatSkeleton(lines: readonly PdfLine[], reveal: ReadonlySet<number>): string {
  const pages = [...new Set(lines.map((l) => l.page))];

  // Rows with several cells whose shape appears on every page: the column titles are among them.
  const repeated: number[] = [];
  if (pages.length > 1) {
    const seen = new Map<string, { pages: Set<number>; numbers: number[] }>();
    lines.forEach((line, index) => {
      if (line.cells.length < 3) return;
      const entry = seen.get(shape(line)) ?? { pages: new Set<number>(), numbers: [] };
      entry.pages.add(line.page);
      entry.numbers.push(index + 1);
      seen.set(shape(line), entry);
    });
    for (const entry of seen.values()) {
      if (entry.pages.size === pages.length) repeated.push(...entry.numbers);
    }
    repeated.sort((a, b) => a - b);
  }

  const out = [
    `Ledger PDF skeleton: ${String(pages.length)} pages, ${String(lines.length)} lines.`,
    'Letters are shown as x or X and digits as 9, so no names, narrations or amounts are visible.',
    'Lines marked * were revealed on request and are shown exactly as printed.',
    '',
  ];
  if (repeated.length > 0) {
    out.push(
      `Repeat on every page (the column titles are usually among these): ${repeated
        .map((n) => lineLabel(n, false).trim())
        .join(', ')}`,
      '',
    );
  }

  let currentPage = 0;
  lines.forEach((line, index) => {
    if (line.page !== currentPage) {
      currentPage = line.page;
      out.push(`== page ${String(currentPage)} ==`);
    }
    const number = index + 1;
    const revealed = reveal.has(number);
    const cells = line.cells
      .map(
        (cell) =>
          `[x${f1(cell.x)}-${f1(cell.right)}] ${revealed ? cell.text : maskText(cell.text)}`,
      )
      .join('  |  ');
    out.push(`${lineLabel(number, revealed)} y=${f1(line.y)}  ${cells}`);
  });
  return out.join('\n');
}
