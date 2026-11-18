/* eslint-disable no-console -- a command-line tool: it only quiets pdf.js's start-up chatter. */
/**
 * Shows the structure of a PDF bank statement with every letter and digit masked, so a bank layout
 * can be written without anyone sharing a statement. Runs on your machine; nothing is uploaded.
 *
 *   pnpm pdf:skeleton "C:\path\to\statement.pdf"
 *   pnpm pdf:skeleton "C:\path\to\statement.pdf" --reveal 14      (show line 14 as printed)
 *
 * The password is asked for in a hidden prompt when the PDF needs one. It is never saved, printed or
 * taken from the command line.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  PdfPasswordError,
  PdfReadError,
  pdfLines,
  readPdfTextItems,
} from '../packages/core/src/index.ts';
import type { PdfJsLike } from '../packages/core/src/index.ts';
import { askHidden } from './pdf/prompt.ts';
import { formatSkeleton, parseLineSelection } from './pdf/skeleton.ts';

const USAGE = `Usage: pnpm pdf:skeleton <statement.pdf> [--reveal <lines>]

  --reveal 14      show line 14 exactly as printed (use it for the column titles)
  --reveal 3,12-14 several lines or ranges

Everything else stays masked: letters become x or X, digits become 9.`;

const MAX_PASSWORD_TRIES = 3;

async function loadPdfJs(): Promise<PdfJsLike> {
  // pdf.js prints harmless warnings about an optional drawing package when it loads.
  const { log, warn } = console;
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    return await import('pdfjs-dist/legacy/build/pdf.mjs');
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { reveal: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  const file = positionals[0];
  if (values.help === true || file === undefined || positionals.length > 1) {
    process.stderr.write(`${USAGE}\n`);
    return values.help === true ? 0 : 2;
  }
  const reveal = parseLineSelection(values.reveal ?? '');

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(file));
  } catch {
    process.stderr.write(
      'Could not read that file. Check the path (put it in quotes if it has spaces).\n',
    );
    return 1;
  }

  const pdfjs = await loadPdfJs();
  let password = '';
  for (let tries = 0; ; tries++) {
    try {
      const items = await readPdfTextItems(pdfjs, bytes, password);
      password = '';
      process.stdout.write(`${formatSkeleton(pdfLines(items), reveal)}\n`);
      if (reveal.size === 0) {
        process.stderr.write(
          '\nNext: find the line holding the column titles (Date, Narration, Amount...) above, then run\n' +
            'this again with --reveal <that line number> and share only that output.\n',
        );
      }
      return 0;
    } catch (error) {
      if (error instanceof PdfPasswordError && tries < MAX_PASSWORD_TRIES) {
        password = await askHidden(
          error.reason === 'wrong'
            ? 'That password did not open the PDF. Try again (hidden): '
            : 'This PDF is password protected. Password (hidden, never saved or printed): ',
        );
        continue;
      }
      if (error instanceof PdfPasswordError) {
        process.stderr.write('The password was wrong too many times. Check it and start again.\n');
      } else if (error instanceof PdfReadError) {
        process.stderr.write(`${error.message}\n`);
      } else {
        process.stderr.write(
          `Something went wrong (${error instanceof Error ? error.name : 'unknown'}).\n`,
        );
      }
      return 1;
    }
  }
}

process.exitCode = await main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Failed'}\n`);
  return 1;
});
