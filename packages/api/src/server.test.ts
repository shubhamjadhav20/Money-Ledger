import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb } from './db/client.ts';
import type { Database } from './db/schema.ts';
import { startServer } from './server.ts';

let db: Kysely<Database>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.destroy();
});

describe('startServer()', () => {
  it('listens on loopback, serves the API, and shuts down cleanly', async () => {
    const running = await startServer({ db, host: '127.0.0.1', port: 0, newId: () => 'x' });
    expect(running.port).toBeGreaterThan(0);
    const health = await fetch(`http://127.0.0.1:${String(running.port)}/health`);
    expect(await health.json()).toEqual({ ok: true });
    expect((await fetch(`http://127.0.0.1:${String(running.port)}/transactions`)).status).toBe(401);
    await running.close();
    await expect(fetch(`http://127.0.0.1:${String(running.port)}/health`)).rejects.toThrow();
  });
});
