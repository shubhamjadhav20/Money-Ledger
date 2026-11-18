/**
 * Writes a FAKE statement PDF to try the PDF import with. Run: pnpm pdf:fake
 * Password protected by default; add --no-password for an open copy. Not committed (random keys).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeSavingsStatement } from './fixtures/generate.ts';
import { FAKE_PDF_PASSWORD, fakeStatementPdf } from './pdf/fake-statement.ts';

const open = process.argv.includes('--no-password');
const folder = join(import.meta.dirname, '..', 'fixtures');
const target = join(folder, `fakebank-savings-2026-10-${open ? 'open' : 'locked'}.pdf`);

const { rows, openingBalance } = fakeSavingsStatement();
const pdf = await fakeStatementPdf(rows, {
  openingBalance,
  ...(open ? {} : { password: FAKE_PDF_PASSWORD }),
});
mkdirSync(folder, { recursive: true });
writeFileSync(target, pdf);
process.stderr.write(`wrote ${target}\n`);
process.stderr.write(
  open ? 'no password\n' : `password: ${FAKE_PDF_PASSWORD} (fake data, fake password)\n`,
);
