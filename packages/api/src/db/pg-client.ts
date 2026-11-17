/**
 * Production database client: Kysely's stock PostgresDialect over a `pg` pool, with the same
 * type parsing as the test client (int8 -> safe integer, date -> 'YYYY-MM-DD' text), so the types in
 * schema.ts are true on both drivers. The parsers are set on this pool only, not globally.
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { parseInt8 } from './client.ts';
import type { Database } from './schema.ts';

type Parser = (value: string) => unknown;

type TypeId = Parameters<typeof pg.types.getTypeParser>[0];

function getTypeParser(id: TypeId, format?: 'text' | 'binary'): Parser {
  if (id === pg.types.builtins.INT8) return parseInt8;
  if (id === pg.types.builtins.DATE) return (text) => text;
  const fallback: unknown = pg.types.getTypeParser(id, format);
  return fallback as Parser;
}

const typeParsers: pg.CustomTypesConfig = { getTypeParser };

export function createPgDb(databaseUrl: string, maxConnections = 5): Kysely<Database> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    types: typeParsers,
  });
  // An idle client failing (server restart) must not crash the process; the next query reconnects.
  pool.on('error', () => undefined);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
