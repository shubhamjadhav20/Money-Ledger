/**
 * Import identity: decides whether a statement row is already in the ledger.
 *
 * identity = base + "#" + occurrence, where
 *   base       = account | date | amount | (bank ref, or normalised counterparty when no ref)
 *   occurrence = 1 for the first row with that base in this statement, 2 for the next, ...
 *
 * The occurrence index is what keeps two genuinely identical purchases (2 x ₹20 chai, same shop,
 * same day, no ref) as two transactions, while re-importing the same file still adds nothing.
 * Core returns the identity string; the API stores sha256(base) + occurrence (core has no crypto).
 *
 * Known limit: if a statement is cut part-way through a day, an identical row on that day can be
 * counted differently across two files. The preview shows duplicates so the user can confirm.
 */
import type { RawRow } from './types.ts';

export function normaliseCounterparty(text: string): string {
  return text
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

type IdentityFields = Pick<RawRow, 'date' | 'amount' | 'counterparty' | 'ref'>;

export function identityBase(accountId: string, row: IdentityFields): string {
  const who =
    row.ref === undefined
      ? `cp:${normaliseCounterparty(row.counterparty)}`
      : `ref:${row.ref.trim()}`;
  return [accountId, row.date, String(row.amount), who].join('|');
}

export interface KeyedRow<T> {
  readonly row: T;
  readonly base: string;
  readonly occurrence: number;
  /** base#occurrence: unique per real transaction within an account. */
  readonly identity: string;
}

export function withOccurrences<T extends IdentityFields>(
  accountId: string,
  rows: readonly T[],
): KeyedRow<T>[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = identityBase(accountId, row);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { row, base, occurrence, identity: `${base}#${String(occurrence)}` };
  });
}

export interface ImportPlan<T> {
  readonly fresh: KeyedRow<T>[];
  readonly duplicates: KeyedRow<T>[];
}

/** Split statement rows into new ones and ones already stored (by identity). Pure and idempotent. */
export function planImport<T extends IdentityFields>(
  accountId: string,
  rows: readonly T[],
  existingIdentities: ReadonlySet<string>,
): ImportPlan<T> {
  const fresh: KeyedRow<T>[] = [];
  const duplicates: KeyedRow<T>[] = [];
  for (const keyed of withOccurrences(accountId, rows)) {
    (existingIdentities.has(keyed.identity) ? duplicates : fresh).push(keyed);
  }
  return { fresh, duplicates };
}
