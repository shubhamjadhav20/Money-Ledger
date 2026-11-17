import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { localDate } from '@ledger/core';
import { createTestDb } from './db/client.ts';
import type { Database } from './db/schema.ts';
import { captureEntry } from './capture-service.ts';
import { confirmImport } from './import-service.ts';

let db: Kysely<Database>;
let counter = 0;
const newId = (): string => `c-${String(++counter)}`;
const context = { today: localDate(2026, 11, 17) };

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
      { id: 'wallet', name: 'Cash', kind: 'cash', statement_day: null, due_day: null },
    ])
    .execute();
});

describe('captureEntry(): "20 food upi" becomes a pending entry', () => {
  it('stores a pending manual spend in the account that owns the method', async () => {
    const result = await captureEntry(db, '20 food upi', context, newId);
    expect(result).toMatchObject({ ok: true, id: 'c-1' });
    const rows = await db.selectFrom('transactions').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      account_id: 'bank',
      amount: -2000,
      date: '2026-11-17',
      method: 'upi',
      category: 'food',
      kind: 'spend',
      source: 'manual',
      status: 'pending',
      identity: null,
    });
  });

  it('routes card to the card account and cash to the cash account', async () => {
    await captureEntry(db, '999 shoes card', context, newId);
    await captureEntry(db, '50 chai cash', context, newId);
    const rows = await db
      .selectFrom('transactions')
      .select(['account_id', 'method'])
      .orderBy('id')
      .execute();
    expect(rows).toEqual([
      { account_id: 'cc', method: 'card' },
      { account_id: 'wallet', method: 'cash' },
    ]);
  });

  it('records income with a plus sign', async () => {
    await captureEntry(db, '+500 gift upi', context, newId);
    const row = await db.selectFrom('transactions').selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ amount: 50_000, kind: 'income' });
  });

  it('returns the grammar error and writes nothing for bad input', async () => {
    const result = await captureEntry(db, 'food upi', context, newId);
    expect(result).toMatchObject({ ok: false });
    expect(await db.selectFrom('transactions').selectAll().execute()).toEqual([]);
  });

  it('says so when no account can hold the method, or when it is ambiguous', async () => {
    await db.deleteFrom('accounts').where('id', '=', 'wallet').execute();
    const noCash = await captureEntry(db, '50 chai cash', context, newId);
    expect(noCash).toMatchObject({ ok: false, error: expect.stringContaining('cash') as string });

    await db
      .insertInto('accounts')
      .values({ id: 'bank2', name: 'Other bank', kind: 'bank', statement_day: null, due_day: null })
      .execute();
    const two = await captureEntry(db, '20 food upi', context, newId);
    expect(two).toMatchObject({
      ok: false,
      error: expect.stringContaining('more than one') as string,
    });
  });

  it('an explicit account id resolves the ambiguity', async () => {
    await db
      .insertInto('accounts')
      .values({ id: 'bank2', name: 'Other bank', kind: 'bank', statement_day: null, due_day: null })
      .execute();
    const result = await captureEntry(db, '20 food upi', context, newId, 'bank2');
    expect(result).toMatchObject({ ok: true });
    expect(
      (await db.selectFrom('transactions').select('account_id').executeTakeFirstOrThrow())
        .account_id,
    ).toBe('bank2');
  });

  it('end to end: a quick-add entry is absorbed by the later statement row, not duplicated', async () => {
    await captureEntry(db, '450 dinner upi yesterday', context, newId);
    const out = await confirmImport(
      db,
      {
        accountId: 'bank',
        source: 'csv',
        contentSha256: 'b'.repeat(64),
        rows: [
          {
            line: 1,
            date: localDate(2026, 11, 17),
            amount: -45_000 as never,
            counterparty: 'UPI/JACOB CAFE',
            memo: '',
          },
        ],
      },
      newId,
    );
    expect(out).toMatchObject({ merged: 1, inserted: 0 });
    const rows = await db.selectFrom('transactions').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'dinner', status: 'posted', date: '2026-11-17' });
  });
});
