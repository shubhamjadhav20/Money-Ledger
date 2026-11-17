/**
 * Database clients. `createTestDb` gives an in-memory real Postgres (PGlite) with migrations
 * applied: integration tests run the same SQL, constraints and transactions as production.
 *
 * Type parsers make runtime values match the table types: int8 -> safe integer (throws if it
 * would lose precision), date -> 'YYYY-MM-DD' text (no timezone shifts).
 */
import { PGlite, types } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { PGliteDialect } from './pglite-dialect.ts';
import { migrateToLatest } from './migrations.ts';
import type { Database } from './schema.ts';

export function parseInt8(text: string): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('bigint column outside the safe integer range');
  }
  return value;
}

export async function createTestDb(): Promise<Kysely<Database>> {
  const pg = new PGlite({
    parsers: {
      [types.INT8]: parseInt8,
      [types.DATE]: (text: string) => text,
    },
  });
  const db = new Kysely<Database>({ dialect: new PGliteDialect(pg) });
  await migrateToLatest(db);
  return db;
}
