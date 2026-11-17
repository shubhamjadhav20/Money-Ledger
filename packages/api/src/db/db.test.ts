import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { localDate, paise } from '@ledger/core';
import { createTestDb, parseInt8 } from './client.ts';
import { migrateToLatest } from './migrations.ts';
import type { Database } from './schema.ts';

let db: Kysely<Database>;
beforeEach(async () => {
  db = await createTestDb();
  await db
    .insertInto('accounts')
    .values({ id: 'bank', name: 'Bank', kind: 'bank', statement_day: null, due_day: null })
    .execute();
});
afterEach(async () => {
  await db.destroy();
});

const manual = (id: string) =>
  ({
    id,
    account_id: 'bank',
    date: localDate(2026, 11, 10),
    amount: paise(-2000),
    ref: null,
    category: 'food',
    kind: 'spend',
    method: 'upi',
    import_batch_id: null,
    identity: null,
    source: 'manual',
    status: 'pending',
  }) as const;

describe('database layer (real Postgres via PGlite)', () => {
  it('migrations are idempotent', async () => {
    expect(await migrateToLatest(db)).toEqual([]);
  });

  it('round-trips money as safe integers and dates as plain text', async () => {
    await db
      .insertInto('transactions')
      .values({ ...manual('t1'), amount: paise(-1_234_567_890_12) })
      .execute();
    const row = await db
      .selectFrom('transactions')
      .selectAll()
      .where('id', '=', 't1')
      .executeTakeFirstOrThrow();
    expect(row.amount).toBe(-123_456_789_012);
    expect(row.date).toBe('2026-11-10');
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('refuses a bigint that cannot be held exactly', () => {
    expect(() => parseInt8('9007199254740993')).toThrow('safe integer');
  });

  it('enforces the domain rules in the database, not only in code', async () => {
    const insert = (over: Record<string, unknown>) =>
      db
        .insertInto('transactions')
        .values({ ...manual('x'), ...over })
        .execute();

    await expect(insert({ amount: 0 })).rejects.toThrow();
    await expect(insert({ kind: 'gift' })).rejects.toThrow();
    await expect(insert({ account_id: 'nope' })).rejects.toThrow();
    // posted without identity, pending with identity
    await expect(insert({ status: 'posted' })).rejects.toThrow();
    await expect(insert({ identity: 'a|b|c#1' })).rejects.toThrow();
    // statement rows are posted; cash never posted
    await expect(insert({ source: 'import' })).rejects.toThrow();
    await expect(insert({ method: 'cash', status: 'posted', identity: 'i#1' })).rejects.toThrow();
  });

  it('refuses the same statement row twice in one account (exactly-once at the storage level)', async () => {
    const posted = (id: string) => ({
      ...manual(id),
      status: 'posted',
      source: 'import',
      identity: 'k#1',
    });
    await db
      .insertInto('transactions')
      .values(posted('a') as never)
      .execute();
    await expect(
      db
        .insertInto('transactions')
        .values(posted('b') as never)
        .execute(),
    ).rejects.toThrow();
  });

  it('rolls back a failed transaction completely', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto('transactions').values(manual('keep-me')).execute();
        await trx
          .insertInto('transactions')
          .values({ ...manual('bad'), amount: 0 as never })
          .execute();
      }),
    ).rejects.toThrow();
    const rows = await db.selectFrom('transactions').select('id').execute();
    expect(rows).toEqual([]);
  });

  it('keeps statement/due day together on an account', async () => {
    await expect(
      db
        .insertInto('accounts')
        .values({ id: 'cc', name: 'Card', kind: 'card', statement_day: 5, due_day: null })
        .execute(),
    ).rejects.toThrow();
  });
});
