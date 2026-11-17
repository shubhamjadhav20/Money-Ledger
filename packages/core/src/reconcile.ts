/**
 * Reconciliation: group opposite-sign transactions (purchase + refund, friend's share + the
 * payment it covered) into bundles whose net is the real spend. PLAN.md rule 3.
 *
 * 1. Link a debit and a credit when they are within `windowDays` calendar days and their
 *    amounts differ by at most the tolerance (fees). Counterparty is NOT a filter here.
 * 2. Split linked transactions into connected groups. For each group:
 *    - exactly one complete pairing  -> one bundle per pair
 *    - several complete pairings     -> one bundle for the whole group (every pairing has the
 *                                       same net, e.g. 2 x 7,250 vs 2 x 7,246, so nothing is guessed)
 *    - no complete pairing, or group too large -> every member goes to review (`unmatched`)
 * 3. A bundle is `settled` only if every pair has similar counterparties; otherwise it is `open`
 *    (a suggestion to confirm). This keeps a coincidental ₹500 in / ₹500 out from hiding spend.
 *
 * Transactions with no candidate at all are ordinary activity, returned as `singles`.
 */
import { daysBetween } from './dates.ts';
import type { LocalDate } from './dates.ts';
import { isPurchaseFlow } from './domain.ts';
import type { TxKind } from './domain.ts';
import { normaliseCounterparty } from './import/identity.ts';
import { sumPaise } from './money.ts';
import type { Paise } from './money.ts';

export interface ReconcileTx {
  readonly id: string;
  readonly accountId: string;
  readonly date: LocalDate;
  readonly amount: Paise;
  readonly counterparty: string;
  /** Transfers, investments and family transfers are never reconciled as spend. */
  readonly kind?: TxKind;
}

export interface ReconcileOptions {
  /** Max calendar days between the two sides of a pair (either order). */
  readonly windowDays: number;
  /** Allowed amount difference: the larger of absPaise and basisPoints of the larger side. */
  readonly tolerance: { readonly absPaise: number; readonly basisPoints: number };
  /** Every pair needs at least this counterparty similarity (0..1) for auto-settle. */
  readonly settleMinSimilarity: number;
  /** Groups with more debits or credits than this go to review. */
  readonly maxGroupSide: number;
}

export const DEFAULT_RECONCILE_OPTIONS: ReconcileOptions = {
  windowDays: 10,
  tolerance: { absPaise: 1000, basisPoints: 0 },
  settleMinSimilarity: 0.5,
  maxGroupSide: 8,
};

export type BundleStatus = 'settled' | 'open';

export interface Bundle {
  /** Deterministic: derived from member ids. */
  readonly id: string;
  readonly txIds: string[];
  /** The real spend (negative) or gain (positive) of the whole bundle. */
  readonly netPaise: Paise;
  readonly status: BundleStatus;
  readonly reason: string;
  /** 0..1, for sorting suggestions. Not used for any money calculation. */
  readonly score: number;
}

export type UnmatchedReason = 'ambiguous' | 'group-too-large';

export interface Unmatched {
  readonly txId: string;
  readonly reason: UnmatchedReason;
  /** Opposite-side transactions it could have matched. */
  readonly relatedTxIds: string[];
}

export interface ReconcileResult {
  readonly bundles: Bundle[];
  /** Had candidates but could not be resolved without guessing: the review queue. */
  readonly unmatched: Unmatched[];
  /** No candidate at all: ordinary transactions. */
  readonly singles: string[];
}

/** Words that describe the payment rail, not the party. */
const NOISE = new Set([
  'UPI',
  'NEFT',
  'IMPS',
  'RTGS',
  'POS',
  'ECOM',
  'ACH',
  'NACH',
  'REFUND',
  'REVERSAL',
  'PAYMENT',
  'TO',
  'FROM',
  'BY',
  'TRF',
  'TRANSFER',
  'CR',
  'DR',
  'INR',
  'REF',
]);

function partyTokens(counterparty: string): Set<string> {
  return new Set(
    normaliseCounterparty(counterparty)
      .split(' ')
      .filter((t) => t.length > 1 && !NOISE.has(t) && !/^\d+$/.test(t)),
  );
}

/** Jaccard similarity of meaningful counterparty words, 0..1. */
export function counterpartySimilarity(a: string, b: string): number {
  const ta = partyTokens(a);
  const tb = partyTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

const byDateThenId = (a: ReconcileTx, b: ReconcileTx): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function allowedDifference(a: Paise, b: Paise, options: ReconcileOptions): number {
  const larger = Math.max(Math.abs(a), Math.abs(b));
  const relative = Math.floor((larger * options.tolerance.basisPoints) / 10_000);
  return Math.max(options.tolerance.absPaise, relative);
}

function linked(debit: ReconcileTx, credit: ReconcileTx, options: ReconcileOptions): boolean {
  return (
    Math.abs(daysBetween(debit.date, credit.date)) <= options.windowDays &&
    Math.abs(debit.amount + credit.amount) <=
      allowedDifference(debit.amount, credit.amount, options)
  );
}

function pairScore(
  debit: ReconcileTx,
  credit: ReconcileTx,
  options: ReconcileOptions,
): { score: number; similarity: number } {
  const similarity = counterpartySimilarity(debit.counterparty, credit.counterparty);
  const amountCloseness =
    1 - Math.abs(debit.amount + credit.amount) / Math.max(1, Math.abs(debit.amount));
  const dateCloseness =
    1 - Math.abs(daysBetween(debit.date, credit.date)) / (options.windowDays + 1);
  return { score: 0.6 * similarity + 0.2 * amountCloseness + 0.2 * dateCloseness, similarity };
}

interface Matching {
  /** Number of complete pairings, capped at 2 (we only need "one" vs "several"). */
  readonly count: number;
  /** pairs[i] = credit index for debit i, in the highest-scoring complete pairing. */
  readonly pairs: number[];
}

/** Count complete pairings (capped) and find the best one, by DP over subsets of credits. */
function completePairings(edges: boolean[][], weights: number[][]): Matching | undefined {
  const n = edges.length;
  const full = (1 << n) - 1;
  const count = new Array<number>(full + 1).fill(0);
  const best = new Array<number>(full + 1).fill(Number.NEGATIVE_INFINITY);
  const choice = new Array<number>(full + 1).fill(-1);
  count[0] = 1;
  best[0] = 0;

  for (let mask = 0; mask < full; mask++) {
    const ways = count[mask] ?? 0;
    if (ways === 0) continue;
    const i = popcount(mask); // next debit to place
    for (let j = 0; j < n; j++) {
      if ((mask & (1 << j)) !== 0 || edges[i]?.[j] !== true) continue;
      const next = mask | (1 << j);
      count[next] = Math.min(2, (count[next] ?? 0) + ways);
      const value = (best[mask] ?? 0) + (weights[i]?.[j] ?? 0);
      if (value > (best[next] ?? Number.NEGATIVE_INFINITY)) {
        best[next] = value;
        choice[next] = j;
      }
    }
  }

  if ((count[full] ?? 0) === 0) return undefined;
  const pairs = new Array<number>(n).fill(-1);
  let mask = full;
  for (let i = n - 1; i >= 0; i--) {
    const j = choice[mask] ?? -1;
    pairs[i] = j;
    mask &= ~(1 << j);
  }
  return { count: count[full] ?? 0, pairs };
}

function popcount(x: number): number {
  let c = 0;
  for (let v = x; v !== 0; v &= v - 1) c++;
  return c;
}

function makeBundle(
  members: readonly ReconcileTx[],
  pairInfo: { score: number; similarity: number }[],
  options: ReconcileOptions,
  reason: string,
): Bundle {
  const txIds = members.map((m) => m.id).sort();
  const settled = pairInfo.every((p) => p.similarity >= options.settleMinSimilarity);
  const score = pairInfo.reduce((s, p) => s + p.score, 0) / pairInfo.length;
  return {
    id: `bundle:${txIds.join('+')}`,
    txIds,
    netPaise: sumPaise(members.map((m) => m.amount)),
    status: settled ? 'settled' : 'open',
    reason: settled ? `${reason}; same counterparty` : `${reason}; counterparties differ, confirm`,
    score: Math.round(score * 1000) / 1000,
  };
}

export function reconcile(
  transactions: readonly ReconcileTx[],
  options: ReconcileOptions = DEFAULT_RECONCILE_OPTIONS,
): ReconcileResult {
  const txs = [...transactions].sort(byDateThenId);
  const eligible = txs.filter((t) => isPurchaseFlow(t.kind) && t.amount !== 0);
  const debits = eligible.filter((t) => t.amount < 0);
  const credits = eligible.filter((t) => t.amount > 0);

  // Union-find over linked debit/credit pairs.
  const parent = new Map<string, string>(eligible.map((t) => [t.id, t.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  const related = new Map<string, string[]>();
  for (const d of debits) {
    for (const c of credits) {
      if (!linked(d, c, options)) continue;
      parent.set(find(d.id), find(c.id));
      related.set(d.id, [...(related.get(d.id) ?? []), c.id]);
      related.set(c.id, [...(related.get(c.id) ?? []), d.id]);
    }
  }

  const groups = new Map<string, ReconcileTx[]>();
  for (const t of eligible) {
    if (!related.has(t.id)) continue;
    const root = find(t.id);
    groups.set(root, [...(groups.get(root) ?? []), t]);
  }

  const bundles: Bundle[] = [];
  const unmatched: Unmatched[] = [];
  const toReview = (members: readonly ReconcileTx[], reason: UnmatchedReason): void => {
    for (const m of members)
      unmatched.push({ txId: m.id, reason, relatedTxIds: related.get(m.id) ?? [] });
  };

  for (const members of groups.values()) {
    const ds = members.filter((m) => m.amount < 0);
    const cs = members.filter((m) => m.amount > 0);
    if (ds.length > options.maxGroupSide || cs.length > options.maxGroupSide) {
      toReview(members, 'group-too-large');
      continue;
    }
    const matching =
      ds.length === cs.length
        ? completePairings(
            ds.map((d) => cs.map((c) => linked(d, c, options))),
            ds.map((d) => cs.map((c) => pairScore(d, c, options).score)),
          )
        : undefined;
    if (matching === undefined) {
      toReview(members, 'ambiguous');
      continue;
    }

    const pairs = ds.map((d, i) => {
      const c = cs[matching.pairs[i] ?? -1];
      if (c === undefined) throw new Error('reconcile: pairing reconstruction failed');
      return { d, c, info: pairScore(d, c, options) };
    });

    if (matching.count === 1) {
      for (const p of pairs)
        bundles.push(makeBundle([p.d, p.c], [p.info], options, 'matched pair'));
    } else {
      bundles.push(
        makeBundle(
          members,
          pairs.map((p) => p.info),
          options,
          'interchangeable group',
        ),
      );
    }
  }

  const bundled = new Set(bundles.flatMap((b) => b.txIds));
  const queued = new Set(unmatched.map((u) => u.txId));
  const singles = txs
    .filter((t) => isPurchaseFlow(t.kind) && !bundled.has(t.id) && !queued.has(t.id))
    .map((t) => t.id);

  bundles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { bundles, unmatched, singles };
}
