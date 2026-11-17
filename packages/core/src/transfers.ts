/**
 * Transfer detection: money moving between the user's own accounts is not spend.
 * Typical cases: card-bill payment (bank debit <-> card credit), savings -> bank, ATM (bank -> cash).
 *
 * A pair is accepted only when it is mutually unique: the debit has exactly one candidate credit
 * and that credit has exactly one candidate debit. Anything else is returned as ambiguous for the
 * user to resolve. Never guess.
 */
import { daysBetween } from './dates.ts';
import type { Account, AccountKind, LedgerTx } from './domain.ts';

export interface TransferOptions {
  /** Max calendar days between the two sides (either order). */
  readonly windowDays: number;
}

export interface TransferPair {
  readonly debitId: string;
  readonly creditId: string;
}

export interface AmbiguousTransfer {
  readonly debitId: string;
  readonly candidateCreditIds: string[];
}

/** Account kinds money can leave for another own account. A card cannot pay into an account. */
const CAN_SEND: ReadonlySet<AccountKind> = new Set(['bank', 'savings', 'cash']);

export function detectTransfers(
  txs: readonly LedgerTx[],
  accounts: readonly Account[],
  options: TransferOptions,
): { pairs: TransferPair[]; ambiguous: AmbiguousTransfer[] } {
  const kindOf = new Map(accounts.map((a) => [a.id, a.kind]));
  for (const t of txs) {
    if (!kindOf.has(t.accountId))
      throw new Error(`Transaction ${t.id} is on unknown account ${t.accountId}`);
  }

  const debits = txs.filter((t) => t.amount < 0 && CAN_SEND.has(kindOf.get(t.accountId) ?? 'card'));
  const credits = txs.filter((t) => t.amount > 0);

  const candidatesOf = new Map<string, LedgerTx[]>();
  const debitsWanting = new Map<string, number>();
  for (const debit of debits) {
    const candidates = credits.filter(
      (credit) =>
        credit.accountId !== debit.accountId &&
        credit.amount + debit.amount === 0 &&
        Math.abs(daysBetween(debit.date, credit.date)) <= options.windowDays,
    );
    candidatesOf.set(debit.id, candidates);
    for (const c of candidates) debitsWanting.set(c.id, (debitsWanting.get(c.id) ?? 0) + 1);
  }

  const pairs: TransferPair[] = [];
  const ambiguous: AmbiguousTransfer[] = [];
  for (const debit of debits) {
    const candidates = candidatesOf.get(debit.id) ?? [];
    const [only] = candidates;
    if (only === undefined) continue;
    if (candidates.length === 1 && debitsWanting.get(only.id) === 1) {
      pairs.push({ debitId: debit.id, creditId: only.id });
    } else {
      ambiguous.push({ debitId: debit.id, candidateCreditIds: candidates.map((c) => c.id) });
    }
  }
  return { pairs, ambiguous };
}
