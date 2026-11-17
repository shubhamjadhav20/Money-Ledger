/**
 * A minimal Kysely dialect over PGlite (Postgres compiled to WASM, runs in-process).
 * Written here instead of adding a third-party dialect package: it is ~60 lines, and every
 * dependency on the money path is supply-chain surface. Production uses the stock PostgresDialect
 * with `pg`; the SQL is identical because both are real Postgres.
 *
 * PGlite has one connection, so acquireConnection serialises callers with a promise chain.
 */
import type { PGlite } from '@electric-sql/pglite';
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult, TransactionSettings } from 'kysely';

class PGliteConnection implements DatabaseConnection {
  readonly #pg: PGlite;
  constructor(pg: PGlite) {
    this.#pg = pg;
  }

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.#pg.query<R>(query.sql, [...query.parameters]);
    const base = { rows: result.rows };
    return result.affectedRows === undefined
      ? base
      : { ...base, numAffectedRows: BigInt(result.affectedRows) };
  }

  // eslint-disable-next-line require-yield, @typescript-eslint/require-await
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('PGlite dialect does not support streaming');
  }
}

class PGliteDriver implements Driver {
  readonly #pg: PGlite;
  #tail: Promise<void> = Promise.resolve();
  readonly #releases = new WeakMap<DatabaseConnection, () => void>();

  constructor(pg: PGlite) {
    this.#pg = pg;
  }

  async init(): Promise<void> {
    await this.#pg.waitReady;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const previous = this.#tail;
    let release: () => void = () => undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const connection = new PGliteConnection(this.#pg);
    this.#releases.set(connection, release);
    return connection;
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    const level = settings.isolationLevel;
    await connection.executeQuery(
      CompiledQuery.raw(level === undefined ? 'begin' : `begin isolation level ${level}`),
    );
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('rollback'));
  }

  releaseConnection(connection: DatabaseConnection): Promise<void> {
    this.#releases.get(connection)?.();
    return Promise.resolve();
  }

  async destroy(): Promise<void> {
    await this.#tail;
    await this.#pg.close();
  }
}

export class PGliteDialect implements Dialect {
  readonly #pg: PGlite;
  constructor(pg: PGlite) {
    this.#pg = pg;
  }
  createAdapter = (): PostgresAdapter => new PostgresAdapter();
  createDriver = (): Driver => new PGliteDriver(this.#pg);
  createIntrospector = (
    db: ConstructorParameters<typeof PostgresIntrospector>[0],
  ): PostgresIntrospector => new PostgresIntrospector(db);
  createQueryCompiler = (): PostgresQueryCompiler => new PostgresQueryCompiler();
}
