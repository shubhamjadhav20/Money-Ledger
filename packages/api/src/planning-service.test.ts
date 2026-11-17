import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { localDate, paise } from '@ledger/core';
import { createTestDb } from './db/client.ts';
import type { Database } from './db/schema.ts';
import {
  PlanningError,
  addPotMovement,
  addScheduled,
  applyPaydayRun,
  computeFree,
  createPot,
  currentBalances,
  deleteScheduled,
  getPaydayRules,
  getSettings,
  listPotMovements,
  listPots,
  previewPayday,
  setCheckpoint,
  setPaydayRules,
  updatePot,
  updateSettings,
} from './planning-service.ts';

let db: Kysely<Database>;
let counter = 0;
const newId = (): string => `p-${String(++counter)}`;
const TODAY = localDate(2026, 11, 17);
const d = (month: number, day: number) => localDate(2026, month, day);

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.destroy();
});

// The journal is append-only (triggers), so the reset bypasses triggers for this session only.
async function reset(): Promise<void> {
  await sql`set session_replication_role = replica`.execute(db);
  await sql`truncate accounts, pots, payday_runs, pot_movements, payday_rules, scheduled_items, balance_checkpoints, transactions, import_batches cascade`.execute(
    db,
  );
  await sql`set session_replication_role = origin`.execute(db);
  await updateSettings(db, {
    payday_day: 7,
    payday_weekend: 'previous-weekday',
    card_exposure: 'all_outstanding',
  });
}

async function tx(
  id: string,
  accountId: string,
  date: ReturnType<typeof d>,
  rupees: number,
  over: {
    status?: 'pending' | 'posted';
    method?: 'upi' | 'card' | 'cash' | 'netbanking';
    kind?: 'spend' | 'income' | 'transfer';
  } = {},
): Promise<void> {
  const status = over.status ?? 'posted';
  await db
    .insertInto('transactions')
    .values({
      id,
      account_id: accountId,
      date,
      amount: paise(Math.round(rupees * 100)),
      ref: null,
      category: null,
      kind: over.kind ?? 'spend',
      method: over.method ?? 'upi',
      import_batch_id: null,
      identity: status === 'posted' ? `${id}#1` : null,
      source: status === 'posted' ? 'import' : 'manual',
      status,
    })
    .execute();
}

beforeEach(async () => {
  await reset();
  await db
    .insertInto('accounts')
    .values([
      { id: 'bank', name: 'Bank', kind: 'bank', statement_day: null, due_day: null },
      { id: 'cc', name: 'Slice', kind: 'card', statement_day: 5, due_day: 25 },
      { id: 'cash', name: 'Cash', kind: 'cash', statement_day: null, due_day: null },
    ])
    .execute();
});

describe('settings', () => {
  it('starts with placeholder defaults and can be patched', async () => {
    expect(await getSettings(db)).toEqual({
      payday_day: 7,
      payday_weekend: 'previous-weekday',
      card_exposure: 'all_outstanding',
    });
    expect(await updateSettings(db, { payday_day: 5 })).toMatchObject({ payday_day: 5 });
    await updateSettings(db, { payday_day: 7 });
  });
  it('the database refuses nonsense', async () => {
    await expect(updateSettings(db, { payday_day: 40 })).rejects.toThrow();
  });
});

describe('pots and the movement journal', () => {
  it('derives balances from movements and never stores them', async () => {
    const pot = await createPot(db, { name: 'SIP', kind: 'bill' }, newId);
    await addPotMovement(
      db,
      { potId: pot, amountPaise: paise(2_500_000), reason: 'manual', date: d(11, 7) },
      newId,
    );
    await addPotMovement(
      db,
      { potId: pot, amountPaise: paise(-2_500_000), reason: 'spend', date: d(11, 10) },
      newId,
    );
    await addPotMovement(
      db,
      { potId: pot, amountPaise: paise(100), reason: 'trueup', date: d(11, 11) },
      newId,
    );
    expect((await listPots(db)).find((p) => p.id === pot)?.balancePaise).toBe(100);
    expect(await listPotMovements(db, pot)).toHaveLength(3);
  });

  it('refuses to edit or delete journal entries', async () => {
    const pot = await createPot(db, { name: 'Journal', kind: 'spend' }, newId);
    const m = await addPotMovement(
      db,
      { potId: pot, amountPaise: paise(5), reason: 'manual', date: d(11, 1) },
      newId,
    );
    await expect(
      db
        .updateTable('pot_movements')
        .set({ amount_paise: paise(9) })
        .where('id', '=', m)
        .execute(),
    ).rejects.toThrow('append-only');
    await expect(db.deleteFrom('pot_movements').where('id', '=', m).execute()).rejects.toThrow(
      'append-only',
    );
  });

  it('validates pots: unknown pot, card-cover only on bill pots of card accounts', async () => {
    await expect(
      addPotMovement(
        db,
        { potId: 'nope', amountPaise: paise(1), reason: 'manual', date: TODAY },
        newId,
      ),
    ).rejects.toThrow(PlanningError);
    await expect(
      createPot(db, { name: 'x', kind: 'bill', coversCardAccountId: 'bank' }, newId),
    ).rejects.toThrow('not a card');
    await expect(
      createPot(db, { name: 'x', kind: 'spend', dueDate: d(12, 1) }, newId),
    ).rejects.toThrow();
    const ok = await createPot(
      db,
      { name: 'Slice bill', kind: 'bill', coversCardAccountId: 'cc' },
      newId,
    );
    expect((await listPots(db)).find((p) => p.id === ok)).toMatchObject({
      coversCardAccountId: 'cc',
    });
  });

  it('updates a pot and reports a missing one', async () => {
    const pot = await createPot(
      db,
      { name: 'Old', kind: 'buffer', targetPaise: paise(100) },
      newId,
    );
    expect(await updatePot(db, pot, { name: 'New', targetPaise: paise(250_000) })).toBe(true);
    expect((await listPots(db)).find((p) => p.id === pot)).toMatchObject({
      name: 'New',
      targetPaise: 250_000,
    });
    expect(await updatePot(db, 'missing', { name: 'x' })).toBe(false);
  });
});

describe('payday rules and runs', () => {
  it('stores ordered rules, previews the split, and applies it once per run id', async () => {
    const sip = await createPot(db, { name: 'SIP pot', kind: 'bill' }, newId);
    const home = await createPot(db, { name: 'Home pot', kind: 'bill' }, newId);
    const buffer = await createPot(
      db,
      { name: 'Buffer pot', kind: 'buffer', targetPaise: paise(250_000) },
      newId,
    );
    await setPaydayRules(
      db,
      [
        { name: 'SIP', kind: 'fixed', amountPaise: 2_500_000, potId: sip },
        { name: 'Mummy', kind: 'fixed', amountPaise: 1_000_000, potId: home },
        { name: 'Buffer', kind: 'fixed', amountPaise: 250_000, potId: buffer },
        { name: 'Rest', kind: 'remainder' },
      ],
      newId,
    );
    expect((await getPaydayRules(db)).map((r) => r.rule.name)).toEqual([
      'SIP',
      'Mummy',
      'Buffer',
      'Rest',
    ]);

    const preview = await previewPayday(db, paise(4_870_000));
    expect(preview.allocations.map((a) => a.allocatedPaise)).toEqual([
      2_500_000, 1_000_000, 250_000, 1_120_000,
    ]);
    expect(preview.unallocatedPaise).toBe(0);

    const first = await applyPaydayRun(db, {
      runId: 'run-dec',
      date: d(12, 7),
      amountPaise: paise(4_870_000),
    });
    expect(first.replayed).toBe(false);
    const again = await applyPaydayRun(db, {
      runId: 'run-dec',
      date: d(12, 7),
      amountPaise: paise(4_870_000),
    });
    expect(again.replayed).toBe(true);
    const balances = new Map((await listPots(db)).map((p) => [p.id, p.balancePaise]));
    expect([balances.get(sip), balances.get(home), balances.get(buffer)]).toEqual([
      2_500_000, 1_000_000, 250_000,
    ]);

    await expect(
      applyPaydayRun(db, { runId: 'run-dec', date: d(12, 7), amountPaise: paise(1) }),
    ).rejects.toThrow('different values');
  });

  it('rejects invalid rule sets and unknown pots, leaving the old rules in place', async () => {
    await setPaydayRules(db, [{ name: 'Rest', kind: 'remainder' }], newId);
    await expect(
      setPaydayRules(
        db,
        [
          { name: 'a', kind: 'remainder' },
          { name: 'b', kind: 'fixed', amountPaise: 1 },
        ],
        newId,
      ),
    ).rejects.toThrow('last rule');
    await expect(
      setPaydayRules(db, [{ name: 'a', kind: 'fixed', amountPaise: 1, potId: 'ghost' }], newId),
    ).rejects.toThrow('pot that does not exist');
    expect((await getPaydayRules(db)).map((r) => r.rule.name)).toEqual(['Rest']);
  });

  it('refuses to preview without rules', async () => {
    await expect(previewPayday(db, paise(100))).rejects.toThrow('Set payday rules');
  });
});

describe('scheduled outflows', () => {
  it('needs exactly one of date or monthly day, and can be deleted', async () => {
    await expect(addScheduled(db, { name: 'x', amountPaise: paise(100) }, newId)).rejects.toThrow(
      'either a date or a monthly day',
    );
    await expect(
      addScheduled(
        db,
        { name: 'x', amountPaise: paise(100), date: d(11, 20), monthlyDay: 5 },
        newId,
      ),
    ).rejects.toThrow();
    const id = await addScheduled(
      db,
      { name: 'Recharge', amountPaise: paise(35_000), date: d(11, 20) },
      newId,
    );
    expect(await deleteScheduled(db, id)).toBe(true);
    expect(await deleteScheduled(db, id)).toBe(false);
  });
});

describe('balances from checkpoints', () => {
  it('adds posted transactions after the checkpoint, ignores earlier ones and other accounts', async () => {
    await setCheckpoint(
      db,
      { accountId: 'bank', date: d(11, 10), amountPaise: paise(1_000_000) },
      newId,
    );
    await tx('before', 'bank', d(11, 9), -100);
    await tx('on-day', 'bank', d(11, 10), -100);
    await tx('after', 'bank', d(11, 12), -500);
    await tx('income', 'bank', d(11, 15), 200, { kind: 'income' });
    const { balances } = await currentBalances(db, TODAY);
    expect(balances.find((b) => b.accountId === 'bank')).toMatchObject({
      balancePaise: 1_000_000 - 50_000 + 20_000,
      asOf: d(11, 10),
    });
    expect(balances.find((b) => b.accountId === 'cc')?.balancePaise).toBeNull();
  });

  it('uses the latest checkpoint on or before today and can overwrite the same date', async () => {
    await setCheckpoint(db, { accountId: 'bank', date: d(11, 1), amountPaise: paise(100) }, newId);
    await setCheckpoint(db, { accountId: 'bank', date: d(11, 12), amountPaise: paise(900) }, newId);
    await setCheckpoint(db, { accountId: 'bank', date: d(11, 12), amountPaise: paise(950) }, newId);
    await setCheckpoint(db, { accountId: 'bank', date: d(11, 30), amountPaise: paise(7) }, newId); // future: ignored
    expect(
      (await currentBalances(db, TODAY)).balances.find((b) => b.accountId === 'bank')?.balancePaise,
    ).toBe(950);
    await expect(
      setCheckpoint(db, { accountId: 'ghost', date: TODAY, amountPaise: paise(1) }, newId),
    ).rejects.toThrow('No account');
  });

  it('cash entries move the cash balance and are not also pending outflows', async () => {
    await setCheckpoint(
      db,
      { accountId: 'cash', date: d(11, 10), amountPaise: paise(200_000) },
      newId,
    );
    await tx('chai', 'cash', d(11, 14), -50, { status: 'pending', method: 'cash' });
    const { balances, pendingOutflows } = await currentBalances(db, TODAY);
    expect(balances.find((b) => b.accountId === 'cash')?.balancePaise).toBe(195_000);
    expect(pendingOutflows).toEqual([]);
  });

  it('counts pending bank entries only when dated after the checkpoint', async () => {
    await setCheckpoint(
      db,
      { accountId: 'bank', date: d(11, 12), amountPaise: paise(100_000) },
      newId,
    );
    await tx('old', 'bank', d(11, 11), -300, { status: 'pending' }); // already reflected in the checkpoint
    await tx('new', 'bank', d(11, 14), -200, { status: 'pending' });
    expect((await currentBalances(db, TODAY)).pendingOutflows).toEqual([
      { id: 'new', amountPaise: -20_000 },
    ]);
  });
});

describe('computeFree(): the headline number', () => {
  async function scenario(): Promise<{ bufferPot: string }> {
    await setCheckpoint(
      db,
      { accountId: 'bank', date: d(11, 10), amountPaise: paise(1_000_000) },
      newId,
    );
    await setCheckpoint(
      db,
      { accountId: 'cc', date: d(11, 10), amountPaise: paise(-76_900) },
      newId,
    );
    await setCheckpoint(
      db,
      { accountId: 'cash', date: d(11, 10), amountPaise: paise(200_000) },
      newId,
    );
    await tx('spend', 'bank', d(11, 12), -500);
    await tx('chai', 'cash', d(11, 14), -50, { status: 'pending', method: 'cash' });
    await tx('dinner', 'bank', d(11, 16), -200, { status: 'pending' });
    await addScheduled(
      db,
      { name: 'Recharge', amountPaise: paise(35_000), date: d(11, 20) },
      newId,
    );
    await addScheduled(
      db,
      { name: 'After payday', amountPaise: paise(99_900), date: d(12, 10) },
      newId,
    );
    const bufferPot = await createPot(
      db,
      { name: 'Buffer', kind: 'buffer', targetPaise: paise(250_000) },
      newId,
    );
    return { bufferPot };
  }

  it('adds up balances, card exposure, buffer, pending entries and scheduled bills until payday', async () => {
    await scenario();
    const out = await computeFree(db, TODAY);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // bank 10,000 - 500 = 9,500 ; cash 2,000 - 50 = 1,950 ; card owed 769 ; buffer 2,500 ;
    // pending 200 ; recharge 350 (the 10 Dec item is after payday).
    expect(out.result.freePaise).toBe(950_000 + 195_000 - 76_900 - 250_000 - 20_000 - 35_000);
    expect(out.result.nextPayday).toBe('2026-12-07');
    expect(out.result.daysToPayday).toBe(20);
    expect(out.result.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(out.result.freePaise);
    expect(out.warnings).toEqual([]);
  });

  it('asks for the missing checkpoints instead of guessing', async () => {
    await setCheckpoint(
      db,
      { accountId: 'bank', date: d(11, 10), amountPaise: paise(1_000) },
      newId,
    );
    const out = await computeFree(db, TODAY);
    expect(out).toEqual({
      ok: false,
      missingCheckpoints: [
        { accountId: 'cash', name: 'Cash' },
        { accountId: 'cc', name: 'Slice' },
      ],
    });
  });

  it('warns when a balance has not been confirmed for over a week', async () => {
    await scenario();
    await setCheckpoint(
      db,
      { accountId: 'cash', date: d(11, 1), amountPaise: paise(200_000) },
      newId,
    );
    await db
      .deleteFrom('balance_checkpoints')
      .where('account_id', '=', 'cash')
      .where('date', '=', d(11, 10))
      .execute();
    const out = await computeFree(db, TODAY);
    expect(out.ok && out.warnings.some((w) => w.includes('Cash') && w.includes('16 days'))).toBe(
      true,
    );
  });

  it('a bill pot that covers a card replaces the raw exposure when it holds more', async () => {
    await scenario();
    const slice = await createPot(
      db,
      { name: 'Slice bill', kind: 'bill', coversCardAccountId: 'cc' },
      newId,
    );
    await addPotMovement(
      db,
      { potId: slice, amountPaise: paise(100_000), reason: 'manual', date: d(11, 11) },
      newId,
    );
    const out = await computeFree(db, TODAY);
    expect(out.ok && out.result.freePaise).toBe(
      950_000 + 195_000 - 100_000 - 250_000 - 20_000 - 35_000,
    );
  });

  it('monthly scheduled items repeat inside the window', async () => {
    await scenario();
    await addScheduled(db, { name: 'Gym EMI', amountPaise: paise(100_000), monthlyDay: 1 }, newId);
    const out = await computeFree(db, TODAY);
    // 1 Dec is before payday (7 Dec) and counted once; 1 Jan is not.
    expect(out.ok && out.result.lines.filter((l) => l.label.startsWith('Gym EMI')).length).toBe(1);
  });

  it('due_before_payday counts only statements that fall due by payday', async () => {
    await scenario();
    await updateSettings(db, { card_exposure: 'due_before_payday' });
    // Statement day 5, due day 25. Purchases 6 Nov to 5 Dec bill on 5 Dec, due 25 Dec: after payday.
    await tx('swipe', 'cc', d(11, 12), -3_000, { method: 'card' });
    const afterPayday = await computeFree(db, TODAY);
    expect(
      afterPayday.ok && afterPayday.result.lines.some((l) => l.label.includes('Slice owed')),
    ).toBe(false);

    // A purchase on the previous statement (6 Oct to 5 Nov) is due 25 Nov: before payday.
    await tx('october', 'cc', d(10, 20), -1_000, { method: 'card' });
    const beforePayday = await computeFree(db, TODAY);
    expect(
      beforePayday.ok &&
        beforePayday.result.lines.find((l) => l.label.includes('Slice owed'))?.amountPaise,
    ).toBe(-100_000);
    await updateSettings(db, { card_exposure: 'all_outstanding' });
  });
});
