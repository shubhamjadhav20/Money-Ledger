/**
 * Runs the production driver against a REAL Postgres. Skipped unless TEST_DATABASE_URL is set
 * (CI provides a service container). The database name must end in `_test`: the suite drops
 * and recreates the public schema.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { localDate, paise } from '@ledger/core';
import { createToken, recordAudit, verifyBearer } from '../auth.ts';
import { confirmImport } from '../import-service.ts';
import { migrateToLatest } from './migrations.ts';
import { createPgDb } from './pg-client.ts';
import type { Database } from './schema.ts';

const url = process.env['TEST_DATABASE_URL'];
const safe = url !== undefined && /\/[A-Za-z0-9_]+_test(?:\?.*)?$/u.test(url);

describe.skipIf(url === undefined)('pg driver on real Postgres', () => {
  let db: Kysely<Database>;
  let counter = 0;
  const newId = (): string => `pg-${String(++counter)}`;

  beforeAll(async () => {
    if (!safe)
      throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
    db = createPgDb(url, 2);
    await sql`drop schema public cascade`.execute(db);
    await sql`create schema public`.execute(db);
    await migrateToLatest(db);
    await db
      .insertInto('accounts')
      .values({ id: 'bank', name: 'Bank', kind: 'bank', statement_day: null, due_day: null })
      .execute();
  });
  afterAll(async () => {
    await db.destroy();
  });

  it('applies migrations once and is idempotent', async () => {
    expect(await migrateToLatest(db)).toEqual([]);
  });

  it('returns bigint as a safe number and date as plain text', async () => {
    await db
      .insertInto('transactions')
      .values({
        id: 'r1',
        account_id: 'bank',
        date: localDate(2026, 11, 10),
        amount: paise(-123_456_789_012),
        ref: null,
        category: null,
        kind: 'spend',
        method: 'upi',
        import_batch_id: null,
        identity: null,
        source: 'manual',
        status: 'pending',
      })
      .execute();
    const row = await db
      .selectFrom('transactions')
      .selectAll()
      .where('id', '=', 'r1')
      .executeTakeFirstOrThrow();
    expect(row.amount).toBe(-123_456_789_012);
    expect(row.date).toBe('2026-11-10');
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it('enforces the constraints and rolls transactions back', async () => {
    await expect(
      db
        .insertInto('transactions')
        .values({
          id: 'bad',
          account_id: 'bank',
          date: localDate(2026, 11, 10),
          amount: paise(0),
          ref: null,
          category: null,
          kind: 'spend',
          method: 'upi',
          import_batch_id: null,
          identity: null,
          source: 'manual',
          status: 'pending',
        })
        .execute(),
    ).rejects.toThrow();
    await expect(
      db.transaction().execute(async (trx) => {
        await trx
          .insertInto('accounts')
          .values({ id: 'tmp', name: 'T', kind: 'bank', statement_day: null, due_day: null })
          .execute();
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await db.selectFrom('accounts').select('id').where('id', '=', 'tmp').execute()).toEqual(
      [],
    );
  });

  it('runs a real import end to end, idempotently', async () => {
    const req = {
      accountId: 'bank',
      source: 'csv' as const,
      contentSha256: 'c'.repeat(64),
      rows: [
        {
          line: 1,
          date: localDate(2026, 11, 3),
          amount: paise(-45_000),
          counterparty: 'UPI/CAFE',
          memo: '',
        },
      ],
    };
    expect(await confirmImport(db, req, newId)).toMatchObject({ inserted: 1 });
    expect(await confirmImport(db, req, newId)).toMatchObject({ inserted: 0, duplicates: 1 });
  });

  it('verifies tokens and keeps the audit log append-only', async () => {
    const { secret } = await createToken(db, { name: 'pg', scope: 'read' }, newId);
    expect(await verifyBearer(db, `Bearer ${secret}`)).toMatchObject({ scope: 'read' });
    await recordAudit(db, { tokenId: null, action: 'pg.test', entity: 'x', detail: { n: 1 } });
    await expect(sql`delete from audit_log`.execute(db)).rejects.toThrow('append-only');
    await expect(sql`truncate audit_log`.execute(db)).rejects.toThrow('append-only');
    const row = await db
      .selectFrom('audit_log')
      .select('detail')
      .where('action', '=', 'pg.test')
      .executeTakeFirstOrThrow();
    expect(row.detail).toEqual({ n: 1 });
  });
});
