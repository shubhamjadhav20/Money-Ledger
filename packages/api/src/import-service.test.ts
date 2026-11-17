import fc from 'fast-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { compileRules, localDate, paise } from '@ledger/core';
import type { RawRow } from '@ledger/core';
import { createTestDb } from './db/client.ts';
import type { Database } from './db/schema.ts';
import { confirmImport, previewImport } from './import-service.ts';
import type { ImportRequest } from './import-service.ts';

const SHA = 'a'.repeat(64);
let db: Kysely<Database>;
let counter = 0;
const newId = (): string => `id-${String(++counter)}`;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('import_batches').execute();
  await db.deleteFrom('accounts').execute();
  await db
    .insertInto('accounts')
    .values([
      { id: 'bank', name: 'Bank', kind: 'bank', statement_day: null, due_day: null },
      { id: 'cc', name: 'Card', kind: 'card', statement_day: 5, due_day: 25 },
    ])
    .execute();
});

const row = (
  line: number,
  day: number,
  rupees: number,
  counterparty: string,
  ref?: string,
): RawRow => ({
  line,
  date: localDate(2026, 11, day),
  amount: paise(Math.round(rupees * 100)),
  counterparty,
  memo: '',
  ...(ref === undefined ? {} : { ref }),
});

const request = (rows: RawRow[], over: Partial<ImportRequest> = {}): ImportRequest => ({
  accountId: 'bank',
  source: 'csv',
  contentSha256: SHA,
  rows,
  ...over,
});

const addPending = async (
  id: string,
  day: number,
  rupees: number,
  over: Record<string, unknown> = {},
): Promise<void> => {
  await db
    .insertInto('transactions')
    .values({
      id,
      account_id: 'bank',
      date: localDate(2026, 11, day),
      amount: paise(Math.round(rupees * 100)),
      memo: 'my memo',
      ref: null,
      category: 'food',
      kind: 'spend',
      method: 'upi',
      import_batch_id: null,
      identity: null,
      source: 'manual',
      status: 'pending',
      ...over,
    } as never)
    .execute();
};

const all = () => db.selectFrom('transactions').selectAll().orderBy('id').execute();

describe('confirmImport(): fresh statement', () => {
  it('inserts every row once, posted, with a batch', async () => {
    const out = await confirmImport(
      db,
      request([row(1, 3, -20, 'UPI/CHAI POINT'), row(2, 4, 50_000, 'SALARY')]),
      newId,
    );
    expect(out).toMatchObject({ inserted: 2, merged: 0, duplicates: 0, held: 0 });
    const txs = await all();
    expect(txs).toHaveLength(2);
    expect(
      txs.every((t) => t.status === 'posted' && t.source === 'import' && t.identity !== null),
    ).toBe(true);
    expect(txs.find((t) => t.counterparty === 'SALARY')).toMatchObject({
      kind: 'income',
      method: 'netbanking',
    });
    expect(txs.find((t) => t.counterparty === 'UPI/CHAI POINT')).toMatchObject({
      kind: 'spend',
      method: 'upi',
    });
    const batches = await db.selectFrom('import_batches').selectAll().execute();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ row_count: 2, content_sha256: SHA, account_id: 'bank' });
  });

  it('keeps two real identical same-day purchases as two transactions', async () => {
    await confirmImport(db, request([row(1, 3, -20, 'CHAI'), row(2, 3, -20, 'CHAI')]), newId);
    expect(await all()).toHaveLength(2);
  });

  it('re-importing the same statement changes nothing and writes no batch', async () => {
    const req = request([
      row(1, 3, -20, 'CHAI'),
      row(2, 3, -20, 'CHAI'),
      row(3, 5, -400, 'GROCER'),
    ]);
    await confirmImport(db, req, newId);
    const before = await all();
    const second = await confirmImport(db, req, newId);
    expect(second).toMatchObject({ inserted: 0, merged: 0, duplicates: 3, held: 0 });
    expect(await all()).toEqual(before);
    expect(await db.selectFrom('import_batches').selectAll().execute()).toHaveLength(1);
  });

  it('applies categoriser rules, including a rule that sets the kind', async () => {
    const { compiled } = compileRules([
      {
        id: 'sip',
        match: { kind: 'contains', value: 'MF SIP' },
        category: 'sip',
        kind: 'investment',
      },
      {
        id: 'mum',
        match: { kind: 'contains', value: 'MUMMY' },
        category: 'household',
        kind: 'family',
      },
    ]);
    await confirmImport(
      db,
      request([row(1, 10, -25_000, 'NACH MF SIP'), row(2, 5, -10_000, 'UPI/MUMMY')], {
        rules: compiled,
      }),
      newId,
    );
    const txs = await all();
    expect(txs.find((t) => t.category === 'sip')?.kind).toBe('investment');
    expect(txs.find((t) => t.category === 'household')?.kind).toBe('family');
  });

  it('uses card as the method on a card account', async () => {
    await confirmImport(db, request([row(1, 3, -999, 'SHOP')], { accountId: 'cc' }), newId);
    expect((await all())[0]?.method).toBe('card');
  });

  it('rejects an unknown account', async () => {
    await expect(confirmImport(db, request([], { accountId: 'nope' }), newId)).rejects.toThrow(
      'account',
    );
  });
});

describe('confirmImport(): manual entries meet the statement (rule 4b)', () => {
  it('merges in place: manual entry survives, becomes posted, takes statement date/ref/amount', async () => {
    await addPending('m1', 10, -450);
    const out = await confirmImport(
      db,
      request([row(1, 11, -450, 'UPI/JACOB CAFE', 'REF9')]),
      newId,
    );
    expect(out).toMatchObject({ inserted: 0, merged: 1, held: 0 });
    const txs = await all();
    expect(txs).toHaveLength(1); // one payment, one row
    expect(txs[0]).toMatchObject({
      id: 'm1',
      status: 'posted',
      category: 'food',
      memo: 'my memo',
      date: '2026-11-11',
      ref: 'REF9',
      counterparty: 'UPI/JACOB CAFE',
      source: 'manual',
    });
    expect(txs[0]?.import_batch_id).not.toBeNull();
    expect(txs[0]?.identity).not.toBeNull();
  });

  it('after a merge, re-importing the statement is a no-op', async () => {
    await addPending('m1', 10, -450);
    const req = request([row(1, 11, -450, 'UPI/JACOB CAFE')]);
    await confirmImport(db, req, newId);
    const before = await all();
    const again = await confirmImport(db, req, newId);
    expect(again).toMatchObject({ inserted: 0, merged: 0, duplicates: 1 });
    expect(await all()).toEqual(before);
  });

  it('never merges cash, a different account, or a late (+3 day) posting', async () => {
    await addPending('cash1', 10, -450, { method: 'cash' });
    await addPending('late', 6, -450);
    const out = await confirmImport(db, request([row(1, 10, -450, 'UPI/X')]), newId);
    expect(out).toMatchObject({ inserted: 1, merged: 0 });
    const txs = await all();
    expect(txs).toHaveLength(3);
    expect(
      txs
        .filter((t) => t.status === 'pending')
        .map((t) => t.id)
        .sort(),
    ).toEqual(['cash1', 'late']);
  });

  it('holds an ambiguous row (not inserted) until the user chooses', async () => {
    await addPending('m1', 10, -20);
    await addPending('m2', 11, -20);
    const req = request([row(1, 10, -20, 'UPI/CHAI')]);

    const preview = await previewImport(db, req);
    expect(preview.ambiguous).toHaveLength(1);
    expect(preview.ambiguous[0]?.pendingIds).toEqual(['m1', 'm2']);

    const held = await confirmImport(db, req, newId);
    expect(held).toMatchObject({ inserted: 0, merged: 0, held: 1 });
    expect((await all()).every((t) => t.status === 'pending')).toBe(true);

    const key = preview.ambiguous[0]?.rowKey ?? '';
    const resolved = await confirmImport(db, { ...req, choices: new Map([[key, 'm2']]) }, newId);
    expect(resolved).toMatchObject({ inserted: 0, merged: 1, held: 0 });
    const txs = await all();
    expect(txs.find((t) => t.id === 'm2')?.status).toBe('posted');
    expect(txs.find((t) => t.id === 'm1')?.status).toBe('pending');
    expect(txs).toHaveLength(2);
  });

  it('a chosen "new" inserts the row and leaves both entries pending', async () => {
    await addPending('m1', 10, -20);
    await addPending('m2', 11, -20);
    const req = request([row(1, 10, -20, 'UPI/CHAI')]);
    const key = (await previewImport(db, req)).ambiguous[0]?.rowKey ?? '';
    const out = await confirmImport(db, { ...req, choices: new Map([[key, 'new']]) }, newId);
    expect(out).toMatchObject({ inserted: 1, merged: 0, held: 0 });
    expect(await all()).toHaveLength(3);
  });

  it('SMS-sourced pending entries match like manual ones', async () => {
    await addPending('sms1', 10, -450, { source: 'sms', category: null, memo: '' });
    const out = await confirmImport(db, request([row(1, 10, -450, 'UPI/X')]), newId);
    expect(out.merged).toBe(1);
  });
});

describe('previewImport(): read-only', () => {
  it('reports what confirm would do and writes nothing', async () => {
    await addPending('m1', 10, -450);
    const preview = await previewImport(
      db,
      request([row(1, 10, -450, 'UPI/A'), row(2, 10, -30, 'UPI/B')]),
    );
    expect(preview).toMatchObject({ duplicateCount: 0 });
    expect(preview.merges).toHaveLength(1);
    expect(preview.toInsert).toHaveLength(1);
    expect((await all()).map((t) => t.status)).toEqual(['pending']);
    expect(await db.selectFrom('import_batches').selectAll().execute()).toEqual([]);
  });
});

describe('confirmImport(): atomicity and the exactly-once invariant', () => {
  it('rolls everything back if one row fails to insert', async () => {
    await addPending('m1', 10, -450);
    // A zero amount violates the table's check; the whole import (including the merge) must undo.
    const bad = request([row(1, 10, -450, 'UPI/A'), row(2, 12, 0, 'UPI/ZERO')]);
    await expect(confirmImport(db, bad, newId)).rejects.toThrow();
    const txs = await all();
    expect(txs).toHaveLength(1);
    expect(txs[0]?.status).toBe('pending');
    expect(await db.selectFrom('import_batches').selectAll().execute()).toEqual([]);
  });

  it('property: every statement row ends as exactly one transaction or is held, and a re-import is a no-op', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 6 }),
            rupees: fc.constantFrom(-20, -20, -45, 100),
            who: fc.constantFrom('UPI/A', 'UPI/B'),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 6 }),
            rupees: fc.constantFrom(-20, -45, 100),
            method: fc.constantFrom('upi', 'cash'),
          }),
          { maxLength: 4 },
        ),
        async (stmt, pend) => {
          await db.deleteFrom('transactions').execute();
          await db.deleteFrom('import_batches').execute();
          for (const [i, p] of pend.entries()) {
            await addPending(`p${String(i)}`, p.day, p.rupees, { method: p.method });
          }
          const rows = stmt.map((s, i) => row(i + 1, s.day, s.rupees, s.who));
          const req = request(rows);

          const first = await confirmImport(db, req, newId);
          expect(first.inserted + first.merged + first.held + first.duplicates).toBe(rows.length);
          const posted = (await all()).filter((t) => t.status === 'posted');
          expect(posted).toHaveLength(first.inserted + first.merged);

          const snapshot = await all();
          const second = await confirmImport(db, req, newId);
          expect(second.inserted).toBe(0);
          expect(second.merged).toBe(0);
          expect(await all()).toEqual(snapshot);
        },
      ),
      { numRuns: 25 },
    );
  }, 60_000);
});
