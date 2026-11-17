import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEMO_MAPPINGS,
  createCsvImporter,
  planImport,
  sumPaise,
} from '../../packages/core/src/index.ts';
import type { RawRow } from '../../packages/core/src/index.ts';
import { generateFixtures } from './generate.ts';

const root = join(import.meta.dirname, '..', '..');

function parse(path: string, mappingId: string, content: string): RawRow[] {
  const mapping = DEMO_MAPPINGS.find((m) => m.id === mappingId);
  if (mapping === undefined) throw new Error(`no mapping ${mappingId}`);
  const { rows, issues } = createCsvImporter(mapping).parse(content);
  expect(issues, path).toEqual([]);
  return rows;
}

describe('generated fixtures', () => {
  const files = generateFixtures();
  const [savingsFile, cardFile] = files;
  if (savingsFile === undefined || cardFile === undefined) throw new Error('expected 2 fixtures');
  const savings = parse(savingsFile.path, savingsFile.mappingId, savingsFile.content);
  const card = parse(cardFile.path, cardFile.mappingId, cardFile.content);

  it('is deterministic for a seed', () => {
    expect(generateFixtures()).toEqual(files);
    expect(generateFixtures(1)).not.toEqual(files);
  });

  it('committed files match the generator (run `pnpm fixtures` after changing it)', () => {
    for (const file of files) {
      expect(readFileSync(join(root, file.path), 'utf8'), file.path).toBe(file.content);
    }
  });

  it('every row parses with the demo mappings (BOM, preamble, CRLF, quoting, footer)', () => {
    expect(savingsFile.content.startsWith('﻿')).toBe(true);
    expect(savings.length).toBe(31);
    expect(card.length).toBe(13);
  });

  it('two identical chai purchases import as two rows, and re-import adds none', () => {
    const chai = savings.filter((r) => r.counterparty === 'UPI/CHAI POINT');
    expect(chai).toHaveLength(2);
    const first = planImport('savings', savings, new Set());
    expect(first.fresh).toHaveLength(savings.length);
    const again = planImport('savings', savings, new Set(first.fresh.map((k) => k.identity)));
    expect(again.fresh).toEqual([]);
  });

  it('contains the card-bill transfer pair', () => {
    const out = savings.find((r) => r.counterparty.includes('CC PAYMENT'));
    const into = card.find((r) => r.counterparty.startsWith('PAYMENT RECEIVED'));
    expect(out?.amount).toBe(-1_234_567);
    expect(into?.amount).toBe(1_234_567);
  });

  it('contains the golden reconcile scenario netting to +₹5', () => {
    const golden = savings.filter(
      (r) => r.date >= '2026-10-14' && r.date <= '2026-10-17' && r.counterparty.includes('TICKETS'),
    );
    expect(golden.map((r) => r.amount).sort((a, b) => a - b)).toEqual([
      -724_600, -724_600, -720_000, 719_700, 725_000, 725_000,
    ]);
    expect(sumPaise(golden.map((r) => r.amount))).toBe(500);
  });

  it('uses only clearly fake names', () => {
    expect(savingsFile.content).toContain('DEMO DATA - NOT A REAL BANK');
  });
});
