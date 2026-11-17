/**
 * Quick-add: text -> parseCapture (core grammar) -> a pending manual entry in the account that
 * owns the payment method. Only creates `pending` rows (the `capture` token scope maps to this).
 */
import { parseCapture } from '@ledger/core';
import type { AccountKind, CaptureContext, CapturedEntry, PaymentMethod } from '@ledger/core';
import type { Kysely } from 'kysely';
import type { Database } from './db/schema.ts';

export type CaptureOutcome =
  | { readonly ok: true; readonly id: string; readonly entry: CapturedEntry }
  | { readonly ok: false; readonly error: string };

const ACCOUNT_KIND_FOR_METHOD: Readonly<Record<PaymentMethod, AccountKind>> = {
  upi: 'bank',
  netbanking: 'bank',
  card: 'card',
  cash: 'cash',
};

export async function captureEntry(
  db: Kysely<Database>,
  text: string,
  context: CaptureContext,
  newId: () => string,
  accountId?: string,
): Promise<CaptureOutcome> {
  const parsed = parseCapture(text, context);
  if (!parsed.ok) return parsed;
  const { entry } = parsed;

  let target = accountId;
  if (target === undefined) {
    const kind = ACCOUNT_KIND_FOR_METHOD[entry.method];
    const candidates = await db
      .selectFrom('accounts')
      .select('id')
      .where('kind', '=', kind)
      .orderBy('id')
      .limit(2)
      .execute();
    if (candidates.length === 0) {
      return { ok: false, error: `No ${kind} account to record a ${entry.method} payment in` };
    }
    if (candidates.length > 1) {
      return {
        ok: false,
        error: `You have more than one ${kind} account: say which one to use for ${entry.method}`,
      };
    }
    target = candidates[0]?.id;
  }
  if (target === undefined) return { ok: false, error: 'No account to record this in' };

  const id = newId();
  await db
    .insertInto('transactions')
    .values({
      id,
      account_id: target,
      date: entry.date,
      amount: entry.amount,
      memo: entry.memo,
      ref: null,
      category: entry.category,
      kind: entry.kind,
      method: entry.method,
      import_batch_id: null,
      identity: null,
      source: 'manual',
      status: 'pending',
    })
    .execute();
  return { ok: true, id, entry };
}
