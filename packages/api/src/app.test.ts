import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { createToken } from './auth.ts';
import type { TokenScope } from './auth.ts';
import { createApp, todayInKolkata } from './app.ts';
import { createTestDb } from './db/client.ts';
import type { Database } from './db/schema.ts';

let db: Kysely<Database>;
let server: Server;
let base = '';
let counter = 0;
const newId = (): string => `h-${String(++counter)}`;
const NOW = new Date('2026-11-17T10:00:00Z'); // 15:30 IST, 17 Nov

const secrets = {} as Record<TokenScope, string>;

beforeAll(async () => {
  db = await createTestDb();
  const app = createApp({ db, newId, now: () => NOW, rateLimits: { capture: 5, default: 100 } });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => {
      resolve(s);
    });
  });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
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
      { id: 'wallet', name: 'Cash', kind: 'cash', statement_day: null, due_day: null },
    ])
    .execute();
  for (const scope of ['capture', 'read', 'full'] as const) {
    secrets[scope] = (await createToken(db, { name: scope, scope }, newId)).secret;
  }
});

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}
async function call(
  method: string,
  path: string,
  options: { scope?: TokenScope | 'none'; token?: string; json?: unknown; raw?: string } = {},
): Promise<Reply> {
  const scope = options.scope ?? 'full';
  const headers: Record<string, string> = {};
  const token = options.token ?? (scope === 'none' ? undefined : secrets[scope]);
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  let body: string | undefined;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.raw !== undefined) {
    headers['content-type'] = 'application/json';
    body = options.raw;
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
    headers: response.headers,
  };
}

const CSV = [
  'Txn Date,Narration,Ref No,Withdrawal Amt,Deposit Amt,Closing Balance',
  '03/11/2026,UPI/JACOB CAFE,R1,450.00,,1000',
  '05/11/2026,SALARY ACME,,,"48,700.00",5000',
].join('\n');
const importBody = (over: Record<string, unknown> = {}) => ({
  accountId: 'bank',
  mappingId: 'fakebank-savings',
  csv: CSV,
  ...over,
});

describe('basics', () => {
  it('GET /health needs no token and sets safe headers', async () => {
    const r = await call('GET', '/health', { scope: 'none' });
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('answers unknown routes and malformed JSON with structured errors', async () => {
    expect((await call('GET', '/nope')).body).toMatchObject({ code: 'not_found' });
    const bad = await call('POST', '/capture', { raw: '{not json' });
    expect(bad).toMatchObject({ status: 400, body: { code: 'invalid_json' } });
  });

  it('todayInKolkata uses the Indian calendar date, not UTC', () => {
    expect(todayInKolkata(new Date('2026-11-16T20:00:00Z'))).toBe('2026-11-17');
    expect(todayInKolkata(new Date('2026-11-17T18:29:00Z'))).toBe('2026-11-17');
    expect(todayInKolkata(new Date('2026-11-17T18:31:00Z'))).toBe('2026-11-18');
  });
});

describe('authentication and scopes', () => {
  it('rejects a missing, malformed or unknown token with 401', async () => {
    for (const r of [
      await call('GET', '/transactions', { scope: 'none' }),
      await call('GET', '/transactions', { token: 'led_short' }),
      await call('GET', '/transactions', { token: `led_${'z'.repeat(43)}` }),
    ]) {
      expect(r).toMatchObject({ status: 401, body: { code: 'unauthorized' } });
      expect(r.headers.get('www-authenticate')).toBe('Bearer');
    }
  });

  it('enforces scopes: capture cannot read, read cannot write, only full manages tokens', async () => {
    expect((await call('GET', '/transactions', { scope: 'capture' })).status).toBe(403);
    expect(
      (await call('POST', '/capture', { scope: 'read', json: { text: '20 food upi' } })).status,
    ).toBe(403);
    expect((await call('POST', '/imports', { scope: 'read', json: importBody() })).status).toBe(
      403,
    );
    expect((await call('GET', '/tokens', { scope: 'read' })).status).toBe(403);
    expect((await call('GET', '/transactions', { scope: 'read' })).status).toBe(200);
    expect(
      (await call('POST', '/capture', { scope: 'capture', json: { text: '20 food upi' } })).status,
    ).toBe(201);
    expect((await call('GET', '/transactions', { scope: 'full' })).status).toBe(200);
  });

  it('a revoked token is refused on the next request', async () => {
    const created = await call('POST', '/tokens', { json: { name: 'bot', scope: 'read' } });
    expect(created.status).toBe(201);
    const token = created.body['token'] as string;
    expect((await call('GET', '/transactions', { token })).status).toBe(200);
    expect((await call('DELETE', `/tokens/${created.body['id'] as string}`)).status).toBe(204);
    expect((await call('GET', '/transactions', { token })).status).toBe(401);
  });
});

describe('POST /capture', () => {
  it('creates a pending manual entry dated today (IST) and audits it without the memo', async () => {
    const r = await call('POST', '/capture', {
      scope: 'capture',
      json: { text: '450 dinner upi at secret-place' },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      entry: { amountPaise: -45_000, category: 'dinner', method: 'upi', date: '2026-11-17' },
    });
    const tx = await db.selectFrom('transactions').selectAll().executeTakeFirstOrThrow();
    expect(tx).toMatchObject({ status: 'pending', source: 'manual', account_id: 'bank' });
    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'capture.create')
      .where('entity_id', '=', r.body['id'] as string)
      .execute();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('secret-place');
  });

  it('returns 422 for text that does not parse, 400 for unknown fields', async () => {
    const bad = await call('POST', '/capture', { json: { text: 'food upi' } });
    expect(bad).toMatchObject({ status: 422, body: { code: 'invalid_capture' } });
    const extra = await call('POST', '/capture', { json: { text: '20 food', admin: true } });
    expect(extra).toMatchObject({ status: 400, body: { code: 'invalid_request' } });
    expect(await db.selectFrom('transactions').selectAll().execute()).toEqual([]);
  });

  it('does not echo submitted values in validation errors', async () => {
    const r = await call('POST', '/capture', { json: { text: 12_345_678 } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('12345678');
  });

  it('rate limits per token', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push(
        (await call('POST', '/capture', { scope: 'capture', json: { text: '5 chai cash' } }))
          .status,
      );
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429, 429]);
    // a different token is not affected
    expect(
      (await call('POST', '/capture', { scope: 'full', json: { text: '5 chai cash' } })).status,
    ).toBe(201);
  });
});

describe('imports', () => {
  it('preview writes nothing; confirm commits; confirming again changes nothing', async () => {
    const preview = await call('POST', '/imports', { json: importBody() });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ duplicateCount: 0, issues: [] });
    expect(preview.body['toInsert']).toHaveLength(2);
    expect(await db.selectFrom('transactions').selectAll().execute()).toEqual([]);

    const confirm = await call('POST', '/imports/confirm', { json: importBody() });
    expect(confirm).toMatchObject({ status: 200, body: { inserted: 2, merged: 0, held: 0 } });
    const again = await call('POST', '/imports/confirm', { json: importBody() });
    expect(again).toMatchObject({ status: 200, body: { inserted: 0, merged: 0, duplicates: 2 } });
    expect(await db.selectFrom('transactions').selectAll().execute()).toHaveLength(2);
    const audit = await db
      .selectFrom('audit_log')
      .select('detail')
      .where('action', '=', 'import.confirm')
      .execute();
    expect(audit[0]?.detail).toMatchObject({ inserted: 2 });
  });

  it('merges a quick-add entry instead of creating a second row', async () => {
    await call('POST', '/capture', { json: { text: '450 dinner upi 2026-11-03' } });
    const confirm = await call('POST', '/imports/confirm', { json: importBody() });
    expect(confirm.body).toMatchObject({ inserted: 1, merged: 1 });
    const rows = await db
      .selectFrom('transactions')
      .select(['category', 'status'])
      .orderBy('date')
      .execute();
    expect(rows).toEqual([
      { category: 'dinner', status: 'posted' },
      { category: null, status: 'posted' },
    ]);
  });

  it('holds ambiguous rows and applies the choices sent with the confirmation', async () => {
    await call('POST', '/capture', { json: { text: '450 a upi 2026-11-03' } });
    await call('POST', '/capture', { json: { text: '450 b upi 2026-11-04' } });
    const preview = await call('POST', '/imports', { json: importBody() });
    const ambiguous = preview.body['ambiguous'] as { rowKey: string; pendingIds: string[] }[];
    expect(ambiguous).toHaveLength(1);

    const held = await call('POST', '/imports/confirm', { json: importBody() });
    expect(held.body).toMatchObject({ inserted: 1, merged: 0, held: 1 });

    const choice = { [ambiguous[0]?.rowKey ?? '']: ambiguous[0]?.pendingIds[1] ?? '' };
    const resolved = await call('POST', '/imports/confirm', {
      json: importBody({ choices: choice }),
    });
    expect(resolved.body).toMatchObject({ merged: 1, held: 0 });
  });

  it('rejects unknown mappings and accounts, and files with parse problems', async () => {
    const unknownMapping = await call('POST', '/imports', {
      json: importBody({ mappingId: 'nope' }),
    });
    expect(unknownMapping).toMatchObject({ status: 400, body: { code: 'unknown_mapping' } });
    expect(
      (await call('POST', '/imports', { json: importBody({ accountId: 'nope' }) })).status,
    ).toBe(404);
    const broken = await call('POST', '/imports/confirm', {
      json: importBody({ csv: 'not,a,statement\n1,2,3' }),
    });
    expect(broken).toMatchObject({ status: 422, body: { code: 'parse_issues' } });
    expect(await db.selectFrom('transactions').selectAll().execute()).toEqual([]);
  });

  it('refuses oversized bodies with 413', async () => {
    const huge = importBody({ csv: 'x'.repeat(2_600_000) });
    expect((await call('POST', '/imports', { json: huge })).status).toBe(413);
  });
});

describe('GET /transactions', () => {
  beforeEach(async () => {
    await call('POST', '/capture', { json: { text: '20 chai upi 2026-11-01' } });
    await call('POST', '/capture', { json: { text: '500 groceries upi 2026-11-10 big_basket' } });
    await call('POST', '/capture', { json: { text: '10 misc upi 2026-11-11 bigXbasket' } });
    await call('POST', '/capture', { json: { text: '30 chai cash 2026-10-30' } });
  });

  it('filters by date range, category and status; newest first', async () => {
    const all = await call('GET', '/transactions?from=2026-11-01&to=2026-11-30', { scope: 'read' });
    const items = all.body['items'] as { category: string; date: string }[];
    expect(items.map((i) => i.date)).toEqual([...items.map((i) => i.date)].sort().reverse());
    expect(items.every((i) => i.date >= '2026-11-01')).toBe(true);
    const chai = await call('GET', '/transactions?category=chai', { scope: 'read' });
    expect((chai.body['items'] as unknown[]).length).toBe(2);
    const posted = await call('GET', '/transactions?status=posted', { scope: 'read' });
    expect(posted.body['items']).toEqual([]);
  });

  it('searches memo text and treats % and _ literally', async () => {
    const hit = await call('GET', `/transactions?q=${encodeURIComponent('big_basket')}`, {
      scope: 'read',
    });
    expect((hit.body['items'] as unknown[]).length).toBe(1);
    const wildcard = await call('GET', `/transactions?q=${encodeURIComponent('%')}`, {
      scope: 'read',
    });
    expect((wildcard.body['items'] as unknown[]).length).toBe(0);
  });

  it('validates query parameters and caps the limit', async () => {
    expect((await call('GET', '/transactions?from=yesterday', { scope: 'read' })).status).toBe(400);
    expect((await call('GET', '/transactions?limit=1000', { scope: 'read' })).status).toBe(400);
    const one = await call('GET', '/transactions?limit=1', { scope: 'read' });
    expect((one.body['items'] as unknown[]).length).toBe(1);
  });
});

describe('GET /summary', () => {
  it('summarises a month by kind and category', async () => {
    await call('POST', '/imports/confirm', { json: importBody() });
    await call('POST', '/capture', { json: { text: '100 chai upi 2026-11-07' } });
    const r = await call('GET', '/summary?month=2026-11', { scope: 'read' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ month: '2026-11', incomePaise: 4_870_000, spendPaise: 55_000 });
  });

  it('validates the month', async () => {
    expect((await call('GET', '/summary?month=2026-13', { scope: 'read' })).status).toBe(400);
    expect((await call('GET', '/summary', { scope: 'read' })).status).toBe(400);
  });
});

describe('tokens', () => {
  it('shows the secret once, lists without secrets, and audits create and revoke', async () => {
    const created = await call('POST', '/tokens', { json: { name: 'mcp', scope: 'read' } });
    expect(created).toMatchObject({ status: 201, body: { name: 'mcp', scope: 'read' } });
    const token = created.body['token'] as string;
    expect(token).toMatch(/^led_/);

    const listed = await call('GET', '/tokens');
    expect(JSON.stringify(listed.body)).not.toContain(token);
    expect((listed.body['items'] as { name: string }[]).map((t) => t.name)).toContain('mcp');

    await call('DELETE', `/tokens/${created.body['id'] as string}`);
    expect((await call('DELETE', '/tokens/missing')).status).toBe(404);
    const actions = (await db.selectFrom('audit_log').select('action').execute()).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['token.create', 'token.revoke']));
  });

  it('validates the body', async () => {
    expect((await call('POST', '/tokens', { json: { name: 'x', scope: 'root' } })).status).toBe(
      400,
    );
    expect((await call('POST', '/tokens', { json: { name: '', scope: 'read' } })).status).toBe(400);
  });
});
