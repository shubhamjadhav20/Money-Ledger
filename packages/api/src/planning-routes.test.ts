import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { items, startHarness } from './test-harness.ts';
import type { Harness } from './test-harness.ts';

const NOW = new Date('2026-11-17T10:00:00Z'); // 17 Nov in India

let h: Harness;
beforeAll(async () => {
  h = await startHarness(NOW, 'r');
});
afterAll(async () => {
  await h.stop();
});
beforeEach(async () => {
  await h.reset();
});

const call = (...args: Parameters<Harness['call']>) => h.call(...args);

describe('scopes', () => {
  const reads = ['/settings', '/pots', '/payday/rules', '/scheduled', '/balances', '/free'];
  it.each(reads)('GET %s needs read scope', async (path) => {
    expect((await call('GET', path, { scope: 'none' })).status).toBe(401);
    expect((await call('GET', path, { scope: 'capture' })).status).toBe(403);
    expect((await call('GET', path, { scope: 'read' })).status).not.toBe(403);
  });

  const writes: [string, string, unknown][] = [
    ['PATCH', '/settings', { paydayDay: 5 }],
    ['POST', '/pots', { name: 'x', kind: 'buffer' }],
    ['PATCH', '/pots/p', { name: 'y' }],
    ['POST', '/pots/p/movements', { amountPaise: 1, reason: 'manual' }],
    ['PUT', '/payday/rules', { rules: [] }],
    ['POST', '/payday/apply', { runId: 'r', amountPaise: 100 }],
    ['POST', '/scheduled', { name: 'x', amountPaise: 100, monthlyDay: 5 }],
    ['DELETE', '/scheduled/s', undefined],
    ['POST', '/balances', { accountId: 'bank', amountPaise: 100 }],
  ];
  it.each(writes)('%s %s needs full scope', async (method, path, json) => {
    const opts = json === undefined ? {} : { json };
    expect((await call(method, path, { ...opts, scope: 'read' })).status).toBe(403);
    expect((await call(method, path, { ...opts, scope: 'capture' })).status).toBe(403);
  });
});

describe('settings', () => {
  it('returns defaults, patches fields, and rejects bad input without echoing it', async () => {
    expect((await call('GET', '/settings')).body).toEqual({
      paydayDay: 7,
      paydayWeekend: 'previous-weekday',
      cardExposure: 'all_outstanding',
    });
    const patched = await call('PATCH', '/settings', {
      json: { paydayDay: 1, cardExposure: 'due_before_payday' },
    });
    expect(patched.body).toMatchObject({ paydayDay: 1, cardExposure: 'due_before_payday' });

    const bad = await call('PATCH', '/settings', { json: { paydayDay: 99123, extra: 'secret-x' } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain('99123');
    expect(JSON.stringify(bad.body)).not.toContain('secret-x');
  });
});

describe('pots', () => {
  it('creates, moves money in and out, edits and lists with derived balances', async () => {
    const created = await call('POST', '/pots', {
      json: { name: 'Slice bill', kind: 'bill', coversCardAccountId: 'cc', dueDate: '2026-11-25' },
    });
    expect(created.status).toBe(201);
    const id = created.body['id'] as string;

    expect(
      (
        await call('POST', `/pots/${id}/movements`, {
          json: { amountPaise: 80000, reason: 'manual' },
        })
      ).status,
    ).toBe(201);
    await call('POST', `/pots/${id}/movements`, {
      json: { amountPaise: -30000, reason: 'spend', date: '2026-11-10' },
    });
    const listed = await call('GET', '/pots');
    expect(items(listed)[0]).toMatchObject({ id, balancePaise: 50000, coversCardAccountId: 'cc' });
    const movements = await call('GET', `/pots/${id}/movements`);
    expect(items(movements).map((m) => [m['amountPaise'], m['date']])).toEqual([
      [-30000, '2026-11-10'],
      [80000, '2026-11-17'],
    ]);

    const edited = await call('PATCH', `/pots/${id}`, { json: { name: 'Card', dueDate: null } });
    expect(edited.body).toMatchObject({ name: 'Card' });
    expect(edited.body['dueDate']).toBeUndefined();
  });

  it('answers 404 for unknown pots and 422 for impossible combinations', async () => {
    expect((await call('PATCH', '/pots/nope', { json: { name: 'x' } })).status).toBe(404);
    expect((await call('GET', '/pots/nope/movements')).status).toBe(404);
    expect(
      (await call('POST', '/pots/nope/movements', { json: { amountPaise: 5, reason: 'manual' } }))
        .status,
    ).toBe(404);
    const spendWithDue = await call('POST', '/pots', {
      json: { name: 'x', kind: 'spend', dueDate: '2026-12-01' },
    });
    expect(spendWithDue).toMatchObject({ status: 422, body: { code: 'invalid_pot' } });
    const coversBank = await call('POST', '/pots', {
      json: { name: 'x', kind: 'bill', coversCardAccountId: 'bank' },
    });
    expect(coversBank).toMatchObject({ status: 422, body: { code: 'wrong_account_kind' } });
    const coversGhost = await call('POST', '/pots', {
      json: { name: 'x', kind: 'bill', coversCardAccountId: 'ghost' },
    });
    expect(coversGhost.status).toBe(404);
    expect(
      (await call('POST', '/pots', { json: { name: 'x', kind: 'buffer', dueDate: '2026-02-30' } }))
        .status,
    ).toBe(400);
  });

  it('refuses a zero-amount movement and unknown fields', async () => {
    const id = (await call('POST', '/pots', { json: { name: 'p', kind: 'spend' } })).body[
      'id'
    ] as string;
    expect(
      (await call('POST', `/pots/${id}/movements`, { json: { amountPaise: 0, reason: 'manual' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('POST', `/pots/${id}/movements`, {
          json: { amountPaise: 5, reason: 'payday' },
        })
      ).status,
    ).toBe(400); // payday movements are only created by a payday run
  });
});

describe('payday', () => {
  async function setup(): Promise<{ sip: string; buffer: string }> {
    const sip = (await call('POST', '/pots', { json: { name: 'SIP', kind: 'bill' } })).body[
      'id'
    ] as string;
    const buffer = (await call('POST', '/pots', { json: { name: 'Buffer', kind: 'buffer' } })).body[
      'id'
    ] as string;
    const put = await call('PUT', '/payday/rules', {
      json: {
        rules: [
          { kind: 'fixed', name: 'SIP', amountPaise: 2_500_000, potId: sip },
          { kind: 'percent', name: 'Buffer', basisPoints: 1000, potId: buffer },
          { kind: 'remainder', name: 'Rest' },
        ],
      },
    });
    expect(put.status).toBe(200);
    return { sip, buffer };
  }

  it('previews without writing, applies once, and replays the same run id', async () => {
    const { sip, buffer } = await setup();
    const preview = await call('POST', '/payday/preview', {
      scope: 'read',
      json: { amountPaise: 4_870_000 },
    });
    expect(preview.status).toBe(200);
    expect(
      (preview.body['allocations'] as { allocatedPaise: number }[]).map((a) => a.allocatedPaise),
    ).toEqual([2_500_000, 487_000, 1_883_000]);
    expect(items(await call('GET', `/pots/${sip}/movements`))).toHaveLength(0);

    const first = await call('POST', '/payday/apply', {
      json: { runId: 'dec-2026', amountPaise: 4_870_000, date: '2026-12-07' },
    });
    expect(first).toMatchObject({ status: 201, body: { replayed: false } });
    const again = await call('POST', '/payday/apply', {
      json: { runId: 'dec-2026', amountPaise: 4_870_000, date: '2026-12-07' },
    });
    expect(again).toMatchObject({ status: 200, body: { replayed: true } });

    const pots = items(await call('GET', '/pots'));
    expect(pots.find((p) => p['id'] === sip)?.['balancePaise']).toBe(2_500_000);
    expect(pots.find((p) => p['id'] === buffer)?.['balancePaise']).toBe(487_000);

    const reused = await call('POST', '/payday/apply', {
      json: { runId: 'dec-2026', amountPaise: 1, date: '2026-12-07' },
    });
    expect(reused).toMatchObject({ status: 409, body: { code: 'run_id_reused' } });
  });

  it('asks for rules first and rejects invalid rule sets', async () => {
    expect(
      (await call('POST', '/payday/preview', { json: { amountPaise: 100 } })).body,
    ).toMatchObject({
      code: 'no_rules',
    });
    const invalid = await call('PUT', '/payday/rules', {
      json: {
        rules: [
          { kind: 'remainder', name: 'a' },
          { kind: 'fixed', name: 'b', amountPaise: 1 },
        ],
      },
    });
    expect(invalid).toMatchObject({ status: 422, body: { code: 'invalid_rules' } });
    const ghost = await call('PUT', '/payday/rules', {
      json: { rules: [{ kind: 'fixed', name: 'a', amountPaise: 1, potId: 'ghost' }] },
    });
    expect(ghost).toMatchObject({ status: 404, body: { code: 'unknown_pot' } });
  });

  it('audit rows carry ids and counts, never amounts', async () => {
    await setup();
    await call('POST', '/payday/apply', {
      json: { runId: 'audit-run', amountPaise: 4_870_000, date: '2026-12-07' },
    });
    const rows = await h.db
      .selectFrom('audit_log')
      .selectAll()
      .where('entity_id', '=', 'audit-run')
      .execute();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain('4870000');
  });
});

describe('scheduled outflows', () => {
  it('adds one-off and monthly items, lists and deletes them', async () => {
    const oneOff = await call('POST', '/scheduled', {
      json: { name: 'Recharge', amountPaise: 35_000, date: '2026-11-20' },
    });
    const monthly = await call('POST', '/scheduled', {
      json: { name: 'Gym', amountPaise: 100_000, monthlyDay: 1 },
    });
    expect([oneOff.status, monthly.status]).toEqual([201, 201]);
    expect(items(await call('GET', '/scheduled')).map((i) => i['name'])).toEqual([
      'Gym',
      'Recharge',
    ]);
    expect((await call('DELETE', `/scheduled/${oneOff.body['id'] as string}`)).status).toBe(204);
    expect((await call('DELETE', `/scheduled/${oneOff.body['id'] as string}`)).status).toBe(404);
  });

  it('needs exactly one of date or monthlyDay', async () => {
    expect(
      (await call('POST', '/scheduled', { json: { name: 'x', amountPaise: 5 } })).body,
    ).toMatchObject({ code: 'invalid_schedule' });
    expect(
      (
        await call('POST', '/scheduled', {
          json: { name: 'x', amountPaise: 5, date: '2026-11-20', monthlyDay: 3 },
        })
      ).status,
    ).toBe(422);
  });
});

describe('balances and /free', () => {
  it('lists what is missing, then returns the number once every account has a balance', async () => {
    const missing = await call('GET', '/free');
    expect(missing).toMatchObject({ status: 409, body: { code: 'missing_balances' } });
    expect((missing.body['details'] as { accountId: string }[]).map((d) => d.accountId)).toEqual([
      'bank',
      'cash',
      'cc',
    ]);

    for (const [accountId, amountPaise] of [
      ['bank', 1_000_000],
      ['cash', 200_000],
      ['cc', -76_900],
    ] as const) {
      expect((await call('POST', '/balances', { json: { accountId, amountPaise } })).status).toBe(
        201,
      );
    }
    await call('POST', '/scheduled', {
      json: { name: 'Recharge', amountPaise: 35_000, date: '2026-11-20' },
    });
    await call('POST', '/pots', { json: { name: 'Buffer', kind: 'buffer', targetPaise: 250_000 } });
    const buffer = items(await call('GET', '/pots'))[0]?.['id'] as string;
    await call('POST', `/pots/${buffer}/movements`, {
      json: { amountPaise: 250_000, reason: 'manual' },
    });

    const free = await call('GET', '/free', { scope: 'read' });
    expect(free.status).toBe(200);
    // 10,000 + 2,000 - 769 card - 2,500 buffer - 350 recharge = 8,381
    expect(free.body).toMatchObject({
      freePaise: 838_100,
      nextPayday: '2026-12-07',
      daysToPayday: 20,
      warnings: [],
    });
    expect((await call('GET', '/balances')).body['items']).toHaveLength(3);
  });

  it('rejects future dates, unknown accounts and impossible dates', async () => {
    const future = await call('POST', '/balances', {
      json: { accountId: 'bank', amountPaise: 1, date: '2026-11-18' },
    });
    expect(future).toMatchObject({ status: 422, body: { code: 'future_date' } });
    expect(
      (await call('POST', '/balances', { json: { accountId: 'ghost', amountPaise: 1 } })).status,
    ).toBe(404);
    expect(
      (
        await call('POST', '/balances', {
          json: { accountId: 'bank', amountPaise: 1, date: '2026-02-30' },
        })
      ).status,
    ).toBe(400);
  });

  it('transaction filters reject impossible dates instead of failing with a 500', async () => {
    expect((await call('GET', '/transactions?from=2026-02-30')).status).toBe(400);
  });
});
