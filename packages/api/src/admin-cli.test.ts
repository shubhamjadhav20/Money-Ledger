import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { verifyBearer } from './auth.ts';
import { runAdmin } from './admin-cli.ts';
import { createTestDb } from './db/client.ts';
import type { Database } from './db/schema.ts';

let db: Kysely<Database>;
let counter = 0;
const newId = (): string => `a-${String(++counter)}`;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await db.deleteFrom('transactions').execute();
  await db.deleteFrom('accounts').execute();
});

async function admin(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runAdmin(db, argv, newId, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, out, err };
}

describe('admin: accounts', () => {
  it('adds and lists accounts', async () => {
    expect(
      (await admin('add-account', '--id', 'bank', '--name', 'Main bank', '--kind', 'bank')).code,
    ).toBe(0);
    expect(
      (
        await admin(
          'add-account',
          '--id',
          'cc',
          '--name',
          'Card',
          '--kind',
          'card',
          '--statement-day',
          '5',
          '--due-day',
          '25',
        )
      ).code,
    ).toBe(0);
    const listed = await admin('list-accounts');
    expect(listed.out.join('\n')).toContain('bank');
    expect(listed.out.join('\n')).toContain('statement day 5');
  });

  it('rejects bad input without touching the database', async () => {
    for (const argv of [
      ['add-account', '--id', 'x', '--name', 'X', '--kind', 'wallet'],
      ['add-account', '--name', 'X', '--kind', 'bank'],
      ['add-account', '--id', 'x', '--name', 'X', '--kind', 'card', '--statement-day', '5'],
      [
        'add-account',
        '--id',
        'x',
        '--name',
        'X',
        '--kind',
        'card',
        '--statement-day',
        '40',
        '--due-day',
        '2',
      ],
    ]) {
      const r = await admin(...argv);
      expect(r.code).toBe(1);
      expect(r.err.length).toBeGreaterThan(0);
    }
    expect(await db.selectFrom('accounts').selectAll().execute()).toEqual([]);
  });

  it('reports a duplicate id plainly', async () => {
    await admin('add-account', '--id', 'bank', '--name', 'Main', '--kind', 'bank');
    const again = await admin('add-account', '--id', 'bank', '--name', 'Other', '--kind', 'bank');
    expect(again).toMatchObject({ code: 1 });
    expect(again.err.join(' ')).toContain('already exists');
  });
});

describe('admin: tokens', () => {
  it('mints a token, prints the secret once, and the secret works', async () => {
    const r = await admin('create-token', '--name', 'laptop', '--scope', 'full');
    expect(r.code).toBe(0);
    const secret = r.out
      .map((l) => /(led_[A-Za-z0-9_-]{43})/u.exec(l)?.[1])
      .find((s) => s !== undefined);
    expect(secret).toBeDefined();
    expect(await verifyBearer(db, `Bearer ${secret ?? ''}`)).toMatchObject({
      name: 'laptop',
      scope: 'full',
    });

    const listed = await admin('list-tokens');
    expect(listed.out.join('\n')).toContain('laptop');
    expect(listed.out.join('\n')).not.toContain(secret ?? 'zzz');
    const audit = await db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'token.create')
      .execute();
    expect(audit.length).toBeGreaterThan(0);
  });

  it('refuses a bad scope or a missing name', async () => {
    expect((await admin('create-token', '--name', 'x', '--scope', 'root')).code).toBe(1);
    expect((await admin('create-token', '--scope', 'read')).code).toBe(1);
  });
});

describe('admin: usage', () => {
  it('prints usage for no command or an unknown one', async () => {
    expect((await admin()).code).toBe(1);
    const unknown = await admin('format-disk');
    expect(unknown.code).toBe(1);
    expect(unknown.err.join('\n')).toContain('create-token');
  });
});
