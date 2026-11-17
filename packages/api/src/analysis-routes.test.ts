import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localDate, paise } from '@ledger/core';
import type { LocalDate, TxKind } from '@ledger/core';
import { items, startHarness } from './test-harness.ts';
import type { Harness } from './test-harness.ts';

const NOW = new Date('2026-11-17T10:00:00Z'); // 17 Nov in India
const d = (month: number, day: number): LocalDate => localDate(2026, month, day);

let h: Harness;
beforeAll(async () => {
  h = await startHarness(NOW, 'a');
});
afterAll(async () => {
  await h.stop();
});
beforeEach(async () => {
  await h.reset();
});

const call = (...args: Parameters<Harness['call']>) => h.call(...args);

async function addTx(
  id: string,
  date: LocalDate,
  rupees: number,
  counterparty: string,
  over: { kind?: TxKind; accountId?: string } = {},
): Promise<void> {
  await h.db
    .insertInto('transactions')
    .values({
      id,
      account_id: over.accountId ?? 'bank',
      date,
      amount: paise(Math.round(rupees * 100)),
      counterparty,
      ref: null,
      category: null,
      kind: over.kind ?? 'spend',
      method: 'upi',
      import_batch_id: null,
      identity: `${id}#1`,
      source: 'import',
      status: 'posted',
    })
    .execute();
}

async function stateBalances(bank = 1_000_000): Promise<void> {
  for (const [accountId, amountPaise] of [
    ['bank', bank],
    ['cash', 0],
    ['cc', 0],
  ] as const) {
    const r = await call('POST', '/balances', {
      json: { accountId, amountPaise, date: '2026-11-10' },
    });
    expect(r.status).toBe(201);
  }
}

/** A grocery spend and a cafe spend over the last 14 days, plus a transfer that must never count. */
async function spendHistory(): Promise<void> {
  await addTx('grocer', d(11, 5), -300, 'UPI/GROCER');
  await addTx('cafe', d(11, 12), -700, 'UPI/JACOB CAFE');
  await addTx('move', d(11, 6), -5000, 'UPI/OWN SAVINGS', { kind: 'transfer' });
}

describe('scopes', () => {
  it.each(['/forecast', '/reconcile'])('GET %s needs read scope', async (path) => {
    expect((await call('GET', path, { scope: 'none' })).status).toBe(401);
    expect((await call('GET', path, { scope: 'capture' })).status).toBe(403);
  });
  it('POST /simulate is a calculation: read scope is enough, capture is not', async () => {
    const json = { amountPaise: 100, method: 'upi' };
    expect((await call('POST', '/simulate', { scope: 'capture', json })).status).toBe(403);
    expect((await call('POST', '/simulate', { scope: 'read', json })).status).not.toBe(403);
  });
  it('PATCH /transactions/:id needs full scope', async () => {
    const json = { category: 'food' };
    expect((await call('PATCH', '/transactions/x', { scope: 'read', json })).status).toBe(403);
  });
});

describe('GET /forecast', () => {
  it('asks for balances first', async () => {
    expect(await call('GET', '/forecast')).toMatchObject({
      status: 409,
      body: { code: 'missing_balances' },
    });
  });

  it('burns reconciled spend only, and projects free money to payday', async () => {
    await stateBalances();
    await spendHistory();
    const r = await call('GET', '/forecast', { scope: 'read' });
    expect(r.status).toBe(200);
    // (300 + 700) / 14 days, rounded up. The 5,000 transfer is not spend.
    expect(r.body).toMatchObject({
      freePaise: 930_000, // 10,000 at 10 Nov, less the 700 cafe spend on the 12th
      nextPayday: '2026-12-07',
      daysToPayday: 20,
      burnPaisePerDay: 7143,
      projectedFreePaise: 930_000 - 7143 * 20,
      runwayDays: 130,
      windowDays: 14,
      estimator: 'mean',
    });
  });

  it('a refund nets the purchase out of burn', async () => {
    await stateBalances();
    await spendHistory();
    await addTx('refund', d(11, 13), 700, 'UPI/JACOB CAFE');
    const r = await call('GET', '/forecast');
    expect(r.body).toMatchObject({ burnPaisePerDay: 2143, freePaise: 1_000_000 });
  });

  it('fixing a transaction kind changes the forecast (transfers are never spend)', async () => {
    await stateBalances();
    await spendHistory();
    expect((await call('PATCH', '/transactions/cafe', { json: { kind: 'transfer' } })).status).toBe(
      200,
    );
    expect((await call('GET', '/forecast')).body).toMatchObject({ burnPaisePerDay: 2143 });
  });

  it('takes a window and estimator, and rejects nonsense', async () => {
    await stateBalances();
    await spendHistory();
    const median = await call('GET', '/forecast?windowDays=30&estimator=median');
    expect(median.body).toMatchObject({ windowDays: 30, estimator: 'median', burnPaisePerDay: 0 });
    expect((await call('GET', '/forecast?windowDays=1')).status).toBe(400);
    expect((await call('GET', '/forecast?estimator=magic')).status).toBe(400);
    expect((await call('GET', '/forecast?extra=1')).status).toBe(400);
  });
});

describe('POST /simulate', () => {
  const sim = (json: unknown, scope: 'read' | 'full' = 'read') =>
    call('POST', '/simulate', { scope, json });

  it('asks for balances first', async () => {
    expect((await sim({ amountPaise: 100, method: 'upi' })).body).toMatchObject({
      code: 'missing_balances',
    });
  });

  it('UPI comes straight off free-to-spend', async () => {
    await stateBalances();
    expect(await sim({ amountPaise: 50_000, method: 'upi' })).toMatchObject({
      status: 200,
      body: { affordableNow: true, freeAfterPaise: 950_000, assumptions: [] },
    });
  });

  it('says so when it cannot be afforded', async () => {
    await stateBalances();
    const r = await sim({ amountPaise: 2_000_000, method: 'upi' });
    expect(r.body).toMatchObject({ affordableNow: false, freeAfterPaise: -1_000_000 });
    expect((r.body['warnings'] as string[])[0]).toContain('short until payday');
  });

  it('card spend lands on the next statement and follows the exposure setting', async () => {
    await stateBalances();
    const all = await sim({ amountPaise: 100_000, method: 'card' });
    expect(all.body).toMatchObject({
      freeAfterPaise: 900_000,
      cardCharge: { statementDate: '2026-12-05', dueDate: '2026-12-25', amountPaise: 100_000 },
    });
    await call('PATCH', '/settings', { json: { cardExposure: 'due_before_payday' } });
    const later = await sim({ amountPaise: 100_000, method: 'card' });
    expect(later.body).toMatchObject({ freeAfterPaise: 1_000_000 }); // due 25 Dec, after payday
    expect((later.body['warnings'] as string[])[0]).toContain('after payday');
  });

  it('Slice in 3 splits over three statements and flags its unverified terms', async () => {
    await stateBalances();
    const r = await sim({ amountPaise: 300_000, method: 'slice_in_3' });
    expect(r.status).toBe(200);
    expect(
      (r.body['installments'] as { amountPaise: number; dueDate: string }[]).map((i) => [
        i.amountPaise,
        i.dueDate,
      ]),
    ).toEqual([
      [100_000, '2026-12-25'],
      [100_000, '2027-01-25'],
      [100_000, '2027-02-25'],
    ]);
    expect(r.body['freeAfterPaise']).toBe(1_000_000); // nothing falls due before payday
    expect(r.body['assumptions']).toHaveLength(1);
  });

  it('needs to know which card when there is not exactly one', async () => {
    await stateBalances();
    await h.db
      .insertInto('accounts')
      .values({ id: 'cc2', name: 'Other card', kind: 'card', statement_day: 10, due_day: 28 })
      .execute();
    await call('POST', '/balances', {
      json: { accountId: 'cc2', amountPaise: 0, date: '2026-11-10' },
    });
    expect(await sim({ amountPaise: 100, method: 'card' })).toMatchObject({
      status: 422,
      body: { code: 'card_required' },
    });
    expect((await sim({ amountPaise: 100, method: 'card', cardAccountId: 'cc2' })).status).toBe(
      200,
    );
    expect((await sim({ amountPaise: 100, method: 'card', cardAccountId: 'ghost' })).status).toBe(
      404,
    );
    expect(
      (await sim({ amountPaise: 100, method: 'card', cardAccountId: 'bank' })).body,
    ).toMatchObject({ code: 'wrong_account_kind' });
  });

  it('rejects bad input without echoing it', async () => {
    const zero = await sim({ amountPaise: 0, method: 'upi' });
    expect(zero.status).toBe(400);
    expect((await sim({ amountPaise: 5, method: 'cash' })).status).toBe(400);
    const extra = await sim({ amountPaise: 5, method: 'upi', note: 'secret-note' });
    expect(extra.status).toBe(400);
    expect(JSON.stringify(extra.body)).not.toContain('secret-note');
  });
});

describe('GET /reconcile', () => {
  async function bundlesAndSingle(): Promise<void> {
    await addTx('cafe', d(11, 12), -700, 'UPI/JACOB CAFE');
    await addTx('cafe-refund', d(11, 13), 700, 'UPI/JACOB CAFE'); // same counterparty: settled
    await addTx('alpha', d(11, 14), -500, 'UPI/ALPHA STORES');
    await addTx('zeta', d(11, 15), 500, 'UPI/ZETA TRADERS'); // different counterparty: open
    await addTx('single', d(11, 3), -90, 'UPI/KIRANA');
  }

  it('returns bundles, single count and the transactions they refer to', async () => {
    await bundlesAndSingle();
    const r = await call('GET', '/reconcile', { scope: 'read' });
    expect(r.status).toBe(200);
    const bundles = r.body['bundles'] as { status: string; txIds: string[]; netPaise: number }[];
    expect(bundles.map((b) => [b.status, b.netPaise]).sort()).toEqual([
      ['open', 0],
      ['settled', 0],
    ]);
    expect(r.body['singleCount']).toBe(1);
    expect(Object.keys(r.body['transactions'] as object).sort()).toEqual([
      'alpha',
      'cafe',
      'cafe-refund',
      'zeta',
    ]);
    expect(r.body).toMatchObject({ from: '2026-10-19', to: '2026-11-17' });
  });

  it('keeps a bundle that touches the range and still shows its other half', async () => {
    await bundlesAndSingle();
    const touching = await call('GET', '/reconcile?from=2026-11-15&to=2026-11-15');
    expect((touching.body['bundles'] as unknown[]).length).toBe(1);
    expect(Object.keys(touching.body['transactions'] as object).sort()).toEqual(['alpha', 'zeta']);
    const outside = await call('GET', '/reconcile?from=2026-11-16&to=2026-11-17');
    expect(outside.body['bundles']).toEqual([]);
  });

  it('puts unresolvable groups in the review queue instead of guessing', async () => {
    await addTx('a', d(11, 14), -500, 'UPI/A');
    await addTx('b', d(11, 15), -500, 'UPI/B');
    await addTx('c', d(11, 16), 500, 'UPI/C');
    const r = await call('GET', '/reconcile');
    expect(r.body['bundles']).toEqual([]);
    const unmatched = r.body['unmatched'] as {
      txId: string;
      reason: string;
      relatedTxIds: string[];
    }[];
    expect(unmatched.map((u) => u.txId).sort()).toEqual(['a', 'b', 'c']);
    expect(unmatched.every((u) => u.reason === 'ambiguous')).toBe(true);
  });

  it('validates the range', async () => {
    expect((await call('GET', '/reconcile?from=2026-11-17&to=2026-11-01')).body).toMatchObject({
      code: 'invalid_range',
    });
    expect((await call('GET', '/reconcile?from=2026-01-01&to=2026-11-17')).body).toMatchObject({
      code: 'range_too_long',
    });
    expect((await call('GET', '/reconcile?from=2026-02-30')).status).toBe(400);
  });
});

describe('PATCH /transactions/:id', () => {
  it('fixes category and kind, and the audit row holds no category text', async () => {
    await addTx('t1', d(11, 12), -700, 'UPI/JACOB CAFE');
    const r = await call('PATCH', '/transactions/t1', {
      json: { category: 'eating-out-secret', kind: 'family' },
    });
    expect(r).toMatchObject({
      status: 200,
      body: { id: 't1', category: 'eating-out-secret', kind: 'family', amountPaise: -70_000 },
    });
    const listed = await call('GET', '/transactions?category=eating-out-secret');
    expect(items(listed).map((t) => t['id'])).toEqual(['t1']);

    const audit = await h.db
      .selectFrom('audit_log')
      .selectAll()
      .where('entity_id', '=', 't1')
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'transaction.update', detail: { fields: 2 } });
    expect(JSON.stringify(audit[0])).not.toContain('eating-out-secret');
  });

  it('clears a category with null and leaves other fields alone', async () => {
    await addTx('t2', d(11, 12), -700, 'UPI/JACOB CAFE');
    await call('PATCH', '/transactions/t2', { json: { category: 'food' } });
    const r = await call('PATCH', '/transactions/t2', { json: { category: null } });
    expect(r.body).toMatchObject({ category: null, kind: 'spend', counterparty: 'UPI/JACOB CAFE' });
  });

  it('rejects empty, unknown and invalid changes, and unknown ids', async () => {
    await addTx('t3', d(11, 12), -700, 'UPI/JACOB CAFE');
    expect((await call('PATCH', '/transactions/t3', { json: {} })).status).toBe(400);
    expect((await call('PATCH', '/transactions/t3', { json: { amountPaise: 1 } })).status).toBe(
      400,
    );
    expect((await call('PATCH', '/transactions/t3', { json: { kind: 'bogus' } })).status).toBe(400);
    expect((await call('PATCH', '/transactions/t3', { json: { category: '' } })).status).toBe(400);
    expect((await call('PATCH', '/transactions/nope', { json: { kind: 'spend' } })).status).toBe(
      404,
    );
  });
});
