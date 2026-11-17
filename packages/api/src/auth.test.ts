import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { createTestDb } from './db/client.ts';
import type { Database } from './db/schema.ts';
import {
  createRateLimiter,
  createToken,
  hashToken,
  listTokens,
  recordAudit,
  revokeToken,
  scopeAllows,
  verifyBearer,
} from './auth.ts';

let db: Kysely<Database>;
let counter = 0;
const newId = (): string => `t-${String(++counter)}`;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom('api_tokens').execute();
});

describe('scopeAllows()', () => {
  it('full can do everything; read and capture only their own', () => {
    expect(scopeAllows('full', 'read')).toBe(true);
    expect(scopeAllows('full', 'capture')).toBe(true);
    expect(scopeAllows('full', 'full')).toBe(true);
    expect(scopeAllows('read', 'read')).toBe(true);
    expect(scopeAllows('read', 'capture')).toBe(false);
    expect(scopeAllows('read', 'full')).toBe(false);
    expect(scopeAllows('capture', 'capture')).toBe(true);
    expect(scopeAllows('capture', 'read')).toBe(false);
    expect(scopeAllows('capture', 'full')).toBe(false);
  });
});

describe('tokens', () => {
  it('creates a high-entropy secret, stores only its hash, and verifies it', async () => {
    const { id, secret } = await createToken(db, { name: 'phone', scope: 'capture' }, newId);
    expect(secret).toMatch(/^led_[A-Za-z0-9_-]{43}$/);
    const stored = await db
      .selectFrom('api_tokens')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored.token_sha256).toBe(hashToken(secret));
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(await verifyBearer(db, `Bearer ${secret}`)).toEqual({
      id,
      name: 'phone',
      scope: 'capture',
    });
  });

  it('two tokens never share a secret', async () => {
    const a = await createToken(db, { name: 'a', scope: 'read' }, newId);
    const b = await createToken(db, { name: 'b', scope: 'read' }, newId);
    expect(a.secret).not.toBe(b.secret);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['no scheme', 'led_abc'],
    ['wrong scheme', 'Basic abc'],
    ['unknown secret', `Bearer led_${'x'.repeat(43)}`],
    ['huge header', `Bearer ${'a'.repeat(10_000)}`],
  ])('rejects %s', async (_name, header) => {
    expect(await verifyBearer(db, header)).toBeUndefined();
  });

  it('a revoked token stops working immediately', async () => {
    const { id, secret } = await createToken(db, { name: 'bot', scope: 'read' }, newId);
    expect(await revokeToken(db, id)).toBe(true);
    expect(await verifyBearer(db, `Bearer ${secret}`)).toBeUndefined();
    expect(await revokeToken(db, id)).toBe(false); // already revoked
    expect(await revokeToken(db, 'missing')).toBe(false);
  });

  it('lists tokens without any secret material and marks revoked ones', async () => {
    const a = await createToken(db, { name: 'a', scope: 'read' }, newId);
    await createToken(db, { name: 'b', scope: 'full' }, newId);
    await revokeToken(db, a.id);
    const list = await listTokens(db);
    expect(list.map((t) => [t.name, t.scope, t.revoked])).toEqual([
      ['a', 'read', true],
      ['b', 'full', false],
    ]);
    expect(JSON.stringify(list)).not.toMatch(/sha256|led_/);
  });

  it('records last use', async () => {
    const { id, secret } = await createToken(db, { name: 'x', scope: 'read' }, newId);
    await verifyBearer(db, `Bearer ${secret}`);
    const row = await db
      .selectFrom('api_tokens')
      .select('last_used_at')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.last_used_at).toBeInstanceOf(Date);
  });

  it('rejects a bad scope or name at the database', async () => {
    await expect(createToken(db, { name: 'x', scope: 'admin' as never }, newId)).rejects.toThrow();
    await expect(createToken(db, { name: '', scope: 'read' }, newId)).rejects.toThrow();
  });
});

describe('audit log', () => {
  it('appends entries and refuses to change or delete them', async () => {
    await recordAudit(db, {
      tokenId: null,
      action: 'test.create',
      entity: 'thing',
      entityId: '1',
      detail: { count: 2 },
    });
    const rows = await db.selectFrom('audit_log').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'test.create', entity: 'thing', detail: { count: 2 } });
    await expect(db.updateTable('audit_log').set({ action: 'x' }).execute()).rejects.toThrow(
      'append-only',
    );
    await expect(db.deleteFrom('audit_log').execute()).rejects.toThrow('append-only');
    expect(await db.selectFrom('audit_log').selectAll().execute()).toHaveLength(1);
  });
});

describe('createRateLimiter()', () => {
  it('allows `limit` hits per window per key, then blocks, then resets', () => {
    let now = 1_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    expect([1, 2, 3, 4].map(() => limiter.hit('a'))).toEqual([true, true, true, false]);
    expect(limiter.hit('b')).toBe(true); // other keys are independent
    now += 60_001;
    expect(limiter.hit('a')).toBe(true);
  });

  it('does not grow without bound', () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 10, now: () => now, maxKeys: 5 });
    for (let i = 0; i < 50; i += 1) {
      now += 20;
      limiter.hit(`k${String(i)}`);
    }
    expect(limiter.size()).toBeLessThanOrEqual(5);
  });
});
