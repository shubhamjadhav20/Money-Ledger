/** Writes the FAKE statement fixtures. Run: pnpm fixtures */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateFixtures } from './fixtures/generate.ts';

const root = join(import.meta.dirname, '..');
for (const file of generateFixtures()) {
  const target = join(root, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
  process.stderr.write(`wrote ${file.path}\n`);
}
