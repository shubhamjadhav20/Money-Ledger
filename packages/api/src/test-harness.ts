/**
 * Shared setup for HTTP tests: an in-memory Postgres, the real app on a random port, three
 * tokens (one per scope) and a `call` helper. Not a test file itself.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { createToken } from './auth.ts';
import type { TokenScope } from './auth.ts';
import { createApp } from './app.ts';
import { createTestDb } from './db/client.ts';
import type { Database } from './db/schema.ts';

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export interface Harness {
  readonly db: Kysely<Database>;
  readonly newId: () => string;
  call(
    method: string,
    path: string,
    options?: { scope?: TokenScope | 'none'; json?: unknown },
  ): Promise<Reply>;
  /** Empties every table (bypassing the append-only triggers for this session only), then seeds accounts and tokens. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export async function startHarness(now: Date, prefix: string): Promise<Harness> {
  const db = await createTestDb();
  let counter = 0;
  const newId = (): string => `${prefix}-${String(++counter)}`;
  const app = createApp({
    db,
    newId,
    now: () => now,
    rateLimits: { capture: 5, default: 100_000 },
  });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => {
      resolve(s);
    });
  });
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  const secrets = {} as Record<TokenScope, string>;

  return {
    db,
    newId,
    async call(method, path, options = {}) {
      const scope = options.scope ?? 'full';
      const headers: Record<string, string> = {};
      if (scope !== 'none') headers['authorization'] = `Bearer ${secrets[scope]}`;
      let body: string | undefined;
      if (options.json !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(options.json);
      }
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
      };
    },
    async reset() {
      await sql`set session_replication_role = replica`.execute(db);
      await sql`truncate accounts, pots, payday_runs, pot_movements, payday_rules, scheduled_items, balance_checkpoints, transactions, import_batches, api_tokens, audit_log cascade`.execute(
        db,
      );
      await sql`set session_replication_role = origin`.execute(db);
      await db
        .updateTable('settings')
        .set({
          payday_day: 7,
          payday_weekend: 'previous-weekday',
          card_exposure: 'all_outstanding',
        })
        .execute();
      await db
        .insertInto('accounts')
        .values([
          { id: 'bank', name: 'Bank', kind: 'bank', statement_day: null, due_day: null },
          { id: 'cc', name: 'Slice', kind: 'card', statement_day: 5, due_day: 25 },
          { id: 'cash', name: 'Cash', kind: 'cash', statement_day: null, due_day: null },
        ])
        .execute();
      for (const scope of ['capture', 'read', 'full'] as const) {
        secrets[scope] = (await createToken(db, { name: scope, scope }, newId)).secret;
      }
    },
    async stop() {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      await db.destroy();
    },
  };
}

export const items = (r: Reply): Record<string, unknown>[] =>
  r.body['items'] as Record<string, unknown>[];
