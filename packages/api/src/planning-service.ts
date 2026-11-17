/**
 * Planning over the database: settings, pots (derived balances), payday runs, scheduled outflows,
 * balance checkpoints, and the free-to-spend number assembled from all of them.
 *
 * Money rules live in core; this file only loads rows, maps them to core inputs, and writes
 * journal entries. Nothing here computes money except by calling core.
 *
 * Balances: the user states "account X had amount Y on date D" (a checkpoint). The balance now is
 * Y plus every transaction after D. Posted rows move bank/savings/card balances; cash has no
 * statement, so its pending entries move the cash balance and are excluded from "pending
 * outflows" (otherwise cash would be counted twice).
 */
import {
  addDays,
  amountDueFor,
  applyPayday,
  dueDateFor,
  freeToSpend,
  negatePaise,
  nextMonthlyDate,
  nextPayday,
  nextStatementDate,
  paise,
  paydayMovements,
  potBalances,
  sumPaise,
  validatePaydayRules,
  PaydayError,
} from '@ledger/core';
import type {
  CardCycle,
  FreeToSpendResult,
  LocalDate,
  Paise,
  PaydayResult,
  PaydayRule,
  Pot,
  PotMovement,
} from '@ledger/core';
import type { Kysely, Selectable } from 'kysely';
import type { Database, PotsTable, SettingsTable } from './db/schema.ts';

export class PlanningError extends Error {
  override name = 'PlanningError';
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** A checkpoint older than this is reported as stale in the free-to-spend warnings. */
export const STALE_CHECKPOINT_DAYS = 7;

// ---- settings -------------------------------------------------------------------------------

export type Settings = Omit<Selectable<SettingsTable>, 'id'>;

export async function getSettings(db: Kysely<Database>): Promise<Settings> {
  const row = await db
    .selectFrom('settings')
    .select(['payday_day', 'payday_weekend', 'card_exposure'])
    .where('id', '=', 1)
    .executeTakeFirstOrThrow();
  return row;
}

export async function updateSettings(
  db: Kysely<Database>,
  patch: Partial<Settings>,
): Promise<Settings> {
  if (Object.keys(patch).length > 0) {
    await db.updateTable('settings').set(patch).where('id', '=', 1).execute();
  }
  return getSettings(db);
}

// ---- pots -----------------------------------------------------------------------------------

export interface PotInput {
  readonly name: string;
  readonly kind: Pot['kind'];
  readonly targetPaise?: Paise | undefined;
  readonly dueDate?: LocalDate | undefined;
  readonly coversCardAccountId?: string | undefined;
}

const toPot = (row: Selectable<PotsTable>): Pot => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  ...(row.target_paise === null ? {} : { targetPaise: row.target_paise }),
  ...(row.due_date === null ? {} : { dueDate: row.due_date }),
  ...(row.covers_card_account_id === null
    ? {}
    : { coversCardAccountId: row.covers_card_account_id }),
});

async function loadPots(db: Kysely<Database>): Promise<Pot[]> {
  const rows = await db.selectFrom('pots').selectAll().orderBy('name').orderBy('id').execute();
  return rows.map(toPot);
}

async function loadMovements(db: Kysely<Database>): Promise<PotMovement[]> {
  const rows = await db
    .selectFrom('pot_movements')
    .selectAll()
    .orderBy('date')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    potId: r.pot_id,
    amountPaise: r.amount_paise,
    reason: r.reason,
    date: r.date,
    ...(r.payday_run_id === null ? {} : { paydayRunId: r.payday_run_id }),
  }));
}

export interface PotView extends Pot {
  readonly balancePaise: Paise;
}

export async function listPots(db: Kysely<Database>): Promise<PotView[]> {
  const [pots, movements] = await Promise.all([loadPots(db), loadMovements(db)]);
  const balances = potBalances(pots, movements);
  return pots.map((p) => ({ ...p, balancePaise: balances.get(p.id) ?? paise(0) }));
}

export async function createPot(
  db: Kysely<Database>,
  input: PotInput,
  newId: () => string,
): Promise<string> {
  if (
    input.kind !== 'bill' &&
    (input.dueDate !== undefined || input.coversCardAccountId !== undefined)
  ) {
    throw new PlanningError('invalid_pot', 'Only bill pots can have a due date or cover a card');
  }
  if (input.coversCardAccountId !== undefined)
    await requireAccountKind(db, input.coversCardAccountId, 'card');
  const id = newId();
  await db
    .insertInto('pots')
    .values({
      id,
      name: input.name,
      kind: input.kind,
      target_paise: input.targetPaise ?? null,
      due_date: input.dueDate ?? null,
      covers_card_account_id: input.coversCardAccountId ?? null,
    })
    .execute();
  return id;
}

export async function updatePot(
  db: Kysely<Database>,
  id: string,
  patch: {
    readonly name?: string;
    readonly targetPaise?: Paise | null;
    readonly dueDate?: LocalDate | null;
  },
): Promise<boolean> {
  if (patch.dueDate !== undefined && patch.dueDate !== null) {
    const pot = await db.selectFrom('pots').select('kind').where('id', '=', id).executeTakeFirst();
    if (pot !== undefined && pot.kind !== 'bill') {
      throw new PlanningError('invalid_pot', 'Only bill pots can have a due date');
    }
  }
  const set: Partial<{ name: string; target_paise: Paise | null; due_date: LocalDate | null }> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.targetPaise !== undefined) set.target_paise = patch.targetPaise;
  if (patch.dueDate !== undefined) set.due_date = patch.dueDate;
  if (Object.keys(set).length === 0) {
    return (
      (await db.selectFrom('pots').select('id').where('id', '=', id).executeTakeFirst()) !==
      undefined
    );
  }
  const result = await db.updateTable('pots').set(set).where('id', '=', id).executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export async function addPotMovement(
  db: Kysely<Database>,
  input: {
    readonly potId: string;
    readonly amountPaise: Paise;
    readonly reason: 'spend' | 'trueup' | 'manual';
    readonly date: LocalDate;
  },
  newId: () => string,
): Promise<string> {
  const pot = await db
    .selectFrom('pots')
    .select('id')
    .where('id', '=', input.potId)
    .executeTakeFirst();
  if (pot === undefined) throw new PlanningError('unknown_pot', 'No pot with that id');
  const id = newId();
  await db
    .insertInto('pot_movements')
    .values({
      id,
      pot_id: input.potId,
      amount_paise: input.amountPaise,
      reason: input.reason,
      date: input.date,
      payday_run_id: null,
    })
    .execute();
  return id;
}

export async function listPotMovements(
  db: Kysely<Database>,
  potId: string,
): Promise<PotMovement[]> {
  return (await loadMovements(db)).filter((m) => m.potId === potId);
}

// ---- payday ---------------------------------------------------------------------------------

export interface StoredPaydayRule {
  readonly id: string;
  readonly rule: PaydayRule;
}

export async function getPaydayRules(db: Kysely<Database>): Promise<StoredPaydayRule[]> {
  const rows = await db.selectFrom('payday_rules').selectAll().orderBy('position').execute();
  return rows.map((r) => {
    const base = { name: r.name, ...(r.pot_id === null ? {} : { potId: r.pot_id }) };
    const rule: PaydayRule =
      r.kind === 'fixed'
        ? { ...base, kind: 'fixed', amountPaise: r.amount_paise ?? 0 }
        : r.kind === 'percent'
          ? { ...base, kind: 'percent', basisPoints: r.basis_points ?? 0 }
          : { ...base, kind: 'remainder' };
    return { id: r.id, rule };
  });
}

/** Replaces the whole ordered rule list (validated by core) in one transaction. */
export async function setPaydayRules(
  db: Kysely<Database>,
  rules: readonly PaydayRule[],
  newId: () => string,
): Promise<void> {
  const problems = validatePaydayRules(rules);
  if (problems.length > 0) throw new PlanningError('invalid_rules', problems.join('; '));
  await db.transaction().execute(async (trx) => {
    for (const rule of rules) {
      if (rule.potId === undefined) continue;
      const pot = await trx
        .selectFrom('pots')
        .select('id')
        .where('id', '=', rule.potId)
        .executeTakeFirst();
      if (pot === undefined)
        throw new PlanningError(
          'unknown_pot',
          `Rule "${rule.name}" points at a pot that does not exist`,
        );
    }
    await trx.deleteFrom('payday_rules').execute();
    for (const [position, rule] of rules.entries()) {
      await trx
        .insertInto('payday_rules')
        .values({
          id: newId(),
          position,
          name: rule.name,
          kind: rule.kind,
          amount_paise: rule.kind === 'fixed' ? paise(rule.amountPaise) : null,
          basis_points: rule.kind === 'percent' ? rule.basisPoints : null,
          pot_id: rule.potId ?? null,
        })
        .execute();
    }
  });
}

export async function previewPayday(db: Kysely<Database>, amount: Paise): Promise<PaydayResult> {
  const rules = (await getPaydayRules(db)).map((r) => r.rule);
  if (rules.length === 0) throw new PlanningError('no_rules', 'Set payday rules first');
  try {
    return applyPayday(amount, rules);
  } catch (error) {
    if (error instanceof PaydayError) throw new PlanningError('invalid_rules', error.message);
    throw error;
  }
}

export interface PaydayRunOutcome {
  readonly runId: string;
  /** True when this exact run already existed and nothing was written. */
  readonly replayed: boolean;
  readonly result: PaydayResult;
}

/**
 * Applies a payday: journals the pot-bound allocations. `runId` is the caller's idempotency key:
 * repeating the same request is a no-op, reusing it with different values is refused.
 */
export async function applyPaydayRun(
  db: Kysely<Database>,
  input: { readonly runId: string; readonly date: LocalDate; readonly amountPaise: Paise },
): Promise<PaydayRunOutcome> {
  const result = await previewPayday(db, input.amountPaise);
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('payday_runs')
      .selectAll()
      .where('id', '=', input.runId)
      .executeTakeFirst();
    if (existing !== undefined) {
      if (existing.date !== input.date || existing.amount_paise !== input.amountPaise) {
        throw new PlanningError(
          'run_id_reused',
          'That run id was already used with different values',
        );
      }
      return { runId: input.runId, replayed: true, result };
    }
    await trx
      .insertInto('payday_runs')
      .values({ id: input.runId, date: input.date, amount_paise: input.amountPaise })
      .execute();
    for (const m of paydayMovements(result, input.date, input.runId)) {
      await trx
        .insertInto('pot_movements')
        .values({
          id: m.id,
          pot_id: m.potId,
          amount_paise: m.amountPaise,
          reason: 'payday',
          date: m.date,
          payday_run_id: input.runId,
        })
        .execute();
    }
    return { runId: input.runId, replayed: false, result };
  });
}

// ---- scheduled outflows ---------------------------------------------------------------------

export interface ScheduledInput {
  readonly name: string;
  readonly amountPaise: Paise;
  readonly date?: LocalDate | undefined;
  readonly monthlyDay?: number | undefined;
}

export async function addScheduled(
  db: Kysely<Database>,
  input: ScheduledInput,
  newId: () => string,
): Promise<string> {
  if ((input.date === undefined) === (input.monthlyDay === undefined)) {
    throw new PlanningError('invalid_schedule', 'Give either a date or a monthly day, not both');
  }
  const id = newId();
  await db
    .insertInto('scheduled_items')
    .values({
      id,
      name: input.name,
      amount_paise: input.amountPaise,
      date: input.date ?? null,
      monthly_day: input.monthlyDay ?? null,
    })
    .execute();
  return id;
}

export async function listScheduled(db: Kysely<Database>) {
  const rows = await db
    .selectFrom('scheduled_items')
    .selectAll()
    .orderBy('name')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    amountPaise: r.amount_paise,
    date: r.date,
    monthlyDay: r.monthly_day,
  }));
}

export async function deleteScheduled(db: Kysely<Database>, id: string): Promise<boolean> {
  const result = await db.deleteFrom('scheduled_items').where('id', '=', id).executeTakeFirst();
  return result.numDeletedRows > 0n;
}

// ---- balance checkpoints --------------------------------------------------------------------

async function requireAccountKind(
  db: Kysely<Database>,
  accountId: string,
  kind?: 'card',
): Promise<void> {
  const row = await db
    .selectFrom('accounts')
    .select('kind')
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (row === undefined) throw new PlanningError('unknown_account', 'No account with that id');
  if (kind !== undefined && row.kind !== kind) {
    throw new PlanningError('wrong_account_kind', `That account is not a ${kind} account`);
  }
}

/** Records "this account had this balance on this date" (cards: negative when money is owed). */
export async function setCheckpoint(
  db: Kysely<Database>,
  input: { readonly accountId: string; readonly date: LocalDate; readonly amountPaise: Paise },
  newId: () => string,
): Promise<void> {
  await requireAccountKind(db, input.accountId);
  await db
    .insertInto('balance_checkpoints')
    .values({
      id: newId(),
      account_id: input.accountId,
      date: input.date,
      amount_paise: input.amountPaise,
    })
    .onConflict((oc) =>
      oc.columns(['account_id', 'date']).doUpdateSet({ amount_paise: input.amountPaise }),
    )
    .execute();
}

export interface AccountBalance {
  readonly accountId: string;
  readonly name: string;
  readonly kind: 'bank' | 'card' | 'savings' | 'cash';
  /** Null when there is no checkpoint on or before today. */
  readonly balancePaise: Paise | null;
  readonly asOf: LocalDate | null;
  readonly cycle: CardCycle | null;
}

export async function currentBalances(
  db: Kysely<Database>,
  today: LocalDate,
): Promise<{ balances: AccountBalance[]; pendingOutflows: { id: string; amountPaise: Paise }[] }> {
  const [accounts, checkpoints, txs] = await Promise.all([
    db.selectFrom('accounts').selectAll().orderBy('id').execute(),
    db.selectFrom('balance_checkpoints').selectAll().where('date', '<=', today).execute(),
    db
      .selectFrom('transactions')
      .select(['id', 'account_id', 'date', 'amount', 'status'])
      .execute(),
  ]);

  const latest = new Map<string, { date: LocalDate; amount: Paise }>();
  for (const c of checkpoints) {
    const best = latest.get(c.account_id);
    if (best === undefined || c.date > best.date)
      latest.set(c.account_id, { date: c.date, amount: c.amount_paise });
  }

  const pendingOutflows: { id: string; amountPaise: Paise }[] = [];
  const balances = accounts.map((a): AccountBalance => {
    const cp = latest.get(a.id);
    const cycle =
      a.statement_day !== null && a.due_day !== null
        ? { statementDay: a.statement_day, dueDay: a.due_day }
        : null;
    if (cp === undefined) {
      return { accountId: a.id, name: a.name, kind: a.kind, balancePaise: null, asOf: null, cycle };
    }
    const after = txs.filter((t) => t.account_id === a.id && t.date > cp.date);
    // Cash is never confirmed by a statement, so its pending entries are its balance movements.
    const moving = after.filter((t) => t.status === 'posted' || a.kind === 'cash');
    if (a.kind !== 'cash') {
      for (const t of after) {
        if (t.status === 'pending' && t.amount < 0)
          pendingOutflows.push({ id: t.id, amountPaise: t.amount });
      }
    }
    return {
      accountId: a.id,
      name: a.name,
      kind: a.kind,
      balancePaise: paise(cp.amount + sumPaise(moving.map((t) => t.amount))),
      asOf: cp.date,
      cycle,
    };
  });
  return { balances, pendingOutflows };
}

// ---- free to spend --------------------------------------------------------------------------

export type FreeOutcome =
  | {
      readonly ok: true;
      readonly result: FreeToSpendResult;
      readonly balances: AccountBalance[];
      readonly warnings: string[];
    }
  | { readonly ok: false; readonly missingCheckpoints: { accountId: string; name: string }[] };

export async function computeFree(db: Kysely<Database>, today: LocalDate): Promise<FreeOutcome> {
  const settings = await getSettings(db);
  const { balances, pendingOutflows } = await currentBalances(db, today);

  const missing = balances.filter((b) => b.balancePaise === null);
  if (missing.length > 0) {
    return {
      ok: false,
      missingCheckpoints: missing.map((b) => ({ accountId: b.accountId, name: b.name })),
    };
  }

  const payday = nextPayday(today, { day: settings.payday_day, weekend: settings.payday_weekend });
  const [pots, movements, scheduled, cardTxs] = await Promise.all([
    loadPots(db),
    loadMovements(db),
    listScheduled(db),
    db
      .selectFrom('transactions')
      .select(['account_id', 'date', 'amount'])
      .where('status', '=', 'posted')
      .execute(),
  ]);
  const balanceByPot = potBalances(pots, movements);

  const scheduledOutflows: { label: string; date: LocalDate; amountPaise: Paise }[] = [];
  for (const item of scheduled) {
    if (item.date !== null) {
      scheduledOutflows.push({ label: item.name, date: item.date, amountPaise: item.amountPaise });
    } else if (item.monthlyDay !== null) {
      let when = nextMonthlyDate(today, item.monthlyDay);
      for (let guard = 0; guard < 14 && when <= payday; guard += 1) {
        scheduledOutflows.push({ label: item.name, date: when, amountPaise: item.amountPaise });
        when = nextMonthlyDate(addDays(when, 1), item.monthlyDay);
      }
    }
  }

  const cards = balances
    .filter((b) => b.kind === 'card')
    .map((b) => {
      const owed =
        b.balancePaise !== null && b.balancePaise < 0 ? negatePaise(b.balancePaise) : paise(0);
      return {
        accountId: b.accountId,
        name: b.name,
        outstandingPaise: owed,
        dueBeforePaydayPaise:
          b.cycle === null
            ? owed // no cycle known: be conservative, assume everything is due
            : dueBefore(
                b.cycle,
                today,
                payday,
                cardTxs.filter((t) => t.account_id === b.accountId),
              ),
      };
    });

  const result = freeToSpend({
    today,
    nextPayday: payday,
    cardExposure: settings.card_exposure,
    liquidBalances: balances
      .filter((b) => b.kind !== 'card')
      .map((b) => ({ accountId: b.accountId, balancePaise: b.balancePaise ?? paise(0) })),
    cards,
    pots: pots.map((pot) => ({ pot, balancePaise: balanceByPot.get(pot.id) ?? paise(0) })),
    pendingOutflows,
    scheduledOutflows,
  });

  const warnings: string[] = [];
  for (const b of balances) {
    if (b.asOf === null) continue;
    const age = daysSince(b.asOf, today);
    if (age > STALE_CHECKPOINT_DAYS) {
      warnings.push(
        `${b.name} balance was last confirmed ${String(age)} days ago (${b.asOf}); update it for a reliable number.`,
      );
    }
  }
  return { ok: true, result, balances, warnings };
}

function daysSince(from: LocalDate, to: LocalDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Statement amounts that fall due between today and payday (statements: the last one and the next). */
function dueBefore(
  cycle: CardCycle,
  today: LocalDate,
  payday: LocalDate,
  cardTxs: readonly { date: LocalDate; amount: Paise }[],
): Paise {
  const nextStatement = nextStatementDate(today, cycle);
  const previousStatement = nextStatementDate(addDays(nextStatement, -35), cycle);
  const statements =
    previousStatement === nextStatement ? [nextStatement] : [previousStatement, nextStatement];
  const due = statements
    .filter((s) => {
      const dueDate = dueDateFor(s, cycle);
      return dueDate >= today && dueDate <= payday;
    })
    .map((s) => amountDueFor(s, cycle, cardTxs));
  return sumPaise(due);
}
