/**
 * Statement import over the database: planImport (skip rows already stored) -> matchStatement
 * (merge into pending manual/SMS entries, hold ambiguity) -> write, all in one transaction.
 *
 * Exactly-once, enforced in three places: planImport drops rows whose identity is stored,
 * matchStatement merges a statement row into the entry for the same payment instead of inserting
 * a second one, and `unique (account_id, identity)` makes the database refuse any slip.
 * `previewImport` runs the same plan with no writes, so what the user confirms is what happens.
 */
import { categorise, matchStatement, planImport, DEFAULT_MATCH_OPTIONS } from '@ledger/core';
import type {
  AccountKind,
  CompiledRule,
  KeyedRow,
  PaymentMethod,
  PendingEntry,
  RawRow,
  TxKind,
} from '@ledger/core';
import type { Kysely } from 'kysely';
import type { Database } from './db/schema.ts';

export interface ImportRequest {
  readonly accountId: string;
  readonly source: 'csv' | 'pdf' | 'aa-sandbox';
  /** sha256 hex of the uploaded file, kept on the batch for audit. */
  readonly contentSha256: string;
  readonly rows: readonly RawRow[];
  readonly rules?: readonly CompiledRule[];
  /** The user's picks for ambiguous rows: row key -> pending entry id, or 'new'. */
  readonly choices?: ReadonlyMap<string, string>;
}

export interface StatementPlan {
  readonly accountKind: AccountKind;
  /** Rows already stored (same identity): ignored. */
  readonly duplicateCount: number;
  /** Rows with no matching entry: become new posted transactions. */
  readonly toInsert: readonly KeyedRow<RawRow>[];
  /** Rows that complete a pending entry in place. */
  readonly merges: readonly { readonly pendingId: string; readonly keyed: KeyedRow<RawRow> }[];
  /** Rows held until the user picks an entry (or "new"). Not inserted, so nothing double-counts. */
  readonly ambiguous: readonly {
    readonly rowKey: string;
    readonly row: RawRow;
    readonly pendingIds: readonly string[];
  }[];
}

export interface ImportOutcome {
  readonly batchId: string | null;
  readonly inserted: number;
  readonly merged: number;
  readonly duplicates: number;
  readonly held: number;
}

/** Which payment methods can appear on this kind of statement. Cash never does. */
export function methodsForAccount(kind: AccountKind): ReadonlySet<PaymentMethod> {
  return kind === 'card'
    ? new Set<PaymentMethod>(['card'])
    : new Set<PaymentMethod>(['upi', 'netbanking']);
}

/** Best guess at how an imported row was paid. The user can correct it later. */
export function inferMethod(kind: AccountKind, counterparty: string): PaymentMethod {
  if (kind === 'card') return 'card';
  return /^\s*upi\b/iu.test(counterparty) ? 'upi' : 'netbanking';
}

export async function planStatement(
  db: Kysely<Database>,
  request: ImportRequest,
): Promise<StatementPlan> {
  const account = await db
    .selectFrom('accounts')
    .select(['id', 'kind'])
    .where('id', '=', request.accountId)
    .executeTakeFirst();
  if (account === undefined) throw new Error(`Unknown account: ${request.accountId}`);

  const stored = await db
    .selectFrom('transactions')
    .select('identity')
    .where('account_id', '=', request.accountId)
    .where('identity', 'is not', null)
    .execute();
  const existing = new Set(stored.flatMap((r) => (r.identity === null ? [] : [r.identity])));
  const { fresh, duplicates } = planImport(request.accountId, request.rows, existing);

  const pendingRows = await db
    .selectFrom('transactions')
    .select(['id', 'account_id', 'method', 'source', 'date', 'amount'])
    .where('account_id', '=', request.accountId)
    .where('status', '=', 'pending')
    .execute();
  const pending: PendingEntry[] = pendingRows.flatMap((p) =>
    p.source === 'import'
      ? []
      : [
          {
            id: p.id,
            accountId: p.account_id,
            method: p.method,
            source: p.source,
            date: p.date,
            amount: p.amount,
          },
        ],
  );

  const byKey = new Map(fresh.map((k) => [k.identity, k]));
  const match = matchStatement(
    request.accountId,
    fresh.map((k) => ({ key: k.identity, date: k.row.date, amount: k.row.amount })),
    pending,
    {
      ...DEFAULT_MATCH_OPTIONS,
      methods: methodsForAccount(account.kind),
      ...(request.choices === undefined ? {} : { choices: request.choices }),
    },
  );

  const keyed = (key: string): KeyedRow<RawRow> => {
    const found = byKey.get(key);
    if (found === undefined) throw new Error('Internal error: matched an unknown statement row');
    return found;
  };

  return {
    accountKind: account.kind,
    duplicateCount: duplicates.length,
    toInsert: match.newRows.map(keyed),
    merges: match.merges.map((m) => ({ pendingId: m.pendingId, keyed: keyed(m.rowKey) })),
    ambiguous: match.ambiguous.map((a) => ({
      rowKey: a.rowKey,
      row: keyed(a.rowKey).row,
      pendingIds: a.pendingIds,
    })),
  };
}

/** What confirming would do. Reads only. */
export function previewImport(
  db: Kysely<Database>,
  request: ImportRequest,
): Promise<StatementPlan> {
  return planStatement(db, request);
}

export async function confirmImport(
  db: Kysely<Database>,
  request: ImportRequest,
  newId: () => string,
): Promise<ImportOutcome> {
  return db.transaction().execute(async (trx) => {
    const plan = await planStatement(trx, request);
    const changed = plan.toInsert.length + plan.merges.length;
    const outcome = {
      inserted: plan.toInsert.length,
      merged: plan.merges.length,
      duplicates: plan.duplicateCount,
      held: plan.ambiguous.length,
    };
    if (changed === 0) return { batchId: null, ...outcome };

    const batchId = newId();
    await trx
      .insertInto('import_batches')
      .values({
        id: batchId,
        account_id: request.accountId,
        source: request.source,
        row_count: changed,
        content_sha256: request.contentSha256,
      })
      .execute();

    for (const { pendingId, keyed } of plan.merges) {
      await trx
        .updateTable('transactions')
        .set({
          date: keyed.row.date,
          amount: keyed.row.amount,
          counterparty: keyed.row.counterparty,
          ref: keyed.row.ref ?? null,
          identity: keyed.identity,
          status: 'posted',
          import_batch_id: batchId,
        })
        .where('id', '=', pendingId)
        .where('status', '=', 'pending')
        .execute();
    }

    const rules = request.rules ?? [];
    for (const keyed of plan.toInsert) {
      const { row } = keyed;
      const hit = categorise(row, rules);
      const kind: TxKind = hit?.kind ?? (row.amount > 0 ? 'income' : 'spend');
      await trx
        .insertInto('transactions')
        .values({
          id: newId(),
          account_id: request.accountId,
          date: row.date,
          amount: row.amount,
          counterparty: row.counterparty,
          ref: row.ref ?? null,
          memo: row.memo,
          category: hit?.category ?? null,
          kind,
          method: inferMethod(plan.accountKind, row.counterparty),
          import_batch_id: batchId,
          identity: keyed.identity,
          source: 'import',
          status: 'posted',
        })
        .execute();
    }
    return { batchId, ...outcome };
  });
}
