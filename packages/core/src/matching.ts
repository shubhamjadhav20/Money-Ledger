/**
 * Manual / SMS entry <-> statement row matching (PLAN.md rule 4b). Pure and deterministic.
 *
 * A manual entry ("20 food upi") is created `pending`. When the statement later arrives, the row
 * for the same payment must MERGE into that entry, not become a second transaction.
 *
 * An entry and a row are candidates when they are in the same account, the entry's method can
 * appear on this statement (never `cash`), the amounts have the same sign and are equal within the
 * tolerance, and the dates are within `windowDays` calendar days either way.
 *
 * Candidates form a graph. Only a component of exactly one row and one entry merges. Anything
 * bigger is ambiguous and is never guessed: the row is held (not inserted, or it would be counted
 * twice if the user then merges it) until `choices` says which entry it is, or "new".
 *
 * Callers run `planImport` first (drops rows already stored), then this on the fresh rows.
 */
import { daysBetween } from './dates.ts';
import type { LocalDate } from './dates.ts';
import type { PaymentMethod } from './domain.ts';
import type { Paise } from './money.ts';

export interface PendingEntry {
  readonly id: string;
  readonly accountId: string;
  readonly method: PaymentMethod;
  readonly source: 'manual' | 'sms';
  readonly date: LocalDate;
  /** Signed: negative = money out. */
  readonly amount: Paise;
}

export interface StatementRow {
  /** Caller's key for the row (e.g. its import identity). */
  readonly key: string;
  readonly date: LocalDate;
  readonly amount: Paise;
}

export interface MatchOptions {
  /** Max calendar days between entry and row, either direction. */
  readonly windowDays: number;
  /** Allowed amount difference: the larger of absPaise and basisPoints of the larger side. */
  readonly tolerance: { readonly absPaise: number; readonly basisPoints: number };
  /** Methods that can show up on this account's statement. `cash` is always excluded. */
  readonly methods: ReadonlySet<PaymentMethod>;
  /** The user's decision per ambiguous row: an entry id, or 'new' to insert it as its own row. */
  readonly choices?: ReadonlyMap<string, string>;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  windowDays: 2,
  // Strict by default: a wrong merge hides a real payment. Raise it per account for known fees.
  tolerance: { absPaise: 0, basisPoints: 0 },
  methods: new Set<PaymentMethod>(['upi', 'netbanking']),
};

export interface MatchResult {
  /** Merge `rowKey` into the pending entry in place: it becomes posted, no new row. */
  readonly merges: { readonly pendingId: string; readonly rowKey: string }[];
  /** Rows with no candidate (or chosen as "new"): insert as new transactions. */
  readonly newRows: string[];
  /** Rows held for the user to pick from `pendingIds` (or "new"). */
  readonly ambiguous: { readonly rowKey: string; readonly pendingIds: string[] }[];
  /** This account's entries left unmerged (still pending). */
  readonly stillPending: string[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function amountsClose(a: Paise, b: Paise, options: MatchOptions): boolean {
  if (a === 0 || b === 0 || a > 0 !== b > 0) return false;
  const larger = Math.max(Math.abs(a), Math.abs(b));
  const allowed = Math.max(
    options.tolerance.absPaise,
    Math.floor((larger * options.tolerance.basisPoints) / 10_000),
  );
  return Math.abs(a - b) <= allowed;
}

const datesClose = (a: LocalDate, b: LocalDate, options: MatchOptions): boolean =>
  Math.abs(daysBetween(a, b)) <= options.windowDays;

/** Connected components over `size` nodes given undirected edges; each component sorted by index. */
function components(size: number, edges: readonly (readonly [number, number])[]): number[][] {
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root] ?? root;
    let node = x;
    while (parent[node] !== root) {
      const next = parent[node] ?? root;
      parent[node] = root;
      node = next;
    }
    return root;
  };
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < size; i += 1) {
    const root = find(i);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [i]);
    else group.push(i);
  }
  return [...groups.values()];
}

export function matchStatement(
  accountId: string,
  rows: readonly StatementRow[],
  pending: readonly PendingEntry[],
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): MatchResult {
  const sortedRows = [...rows].sort((a, b) => byText(a.key, b.key));
  const inAccount = pending.filter((p) => p.accountId === accountId);
  const entries = inAccount
    .filter((p) => p.method !== 'cash' && options.methods.has(p.method))
    .sort((a, b) => byText(a.id, b.id));

  // Nodes: rows are 0..R-1, entries are R..R+E-1.
  const edges: [number, number][] = [];
  const candidates = new Map<number, number[]>();
  sortedRows.forEach((row, r) => {
    entries.forEach((entry, e) => {
      if (
        amountsClose(row.amount, entry.amount, options) &&
        datesClose(row.date, entry.date, options)
      ) {
        edges.push([r, sortedRows.length + e]);
        candidates.set(r, [...(candidates.get(r) ?? []), e]);
      }
    });
  });

  const merges: { pendingId: string; rowKey: string }[] = [];
  const newRows: string[] = [];
  const held: { rowKey: string; pendingIds: string[] }[] = [];

  for (const group of components(sortedRows.length + entries.length, edges)) {
    const rowIdx = group.filter((n) => n < sortedRows.length);
    const entryIdx = group.filter((n) => n >= sortedRows.length);
    if (rowIdx.length === 1 && entryIdx.length === 0) {
      newRows.push(sortedRows[rowIdx[0] ?? 0]?.key ?? '');
    } else if (rowIdx.length === 1 && entryIdx.length === 1) {
      merges.push({
        pendingId: entries[(entryIdx[0] ?? 0) - sortedRows.length]?.id ?? '',
        rowKey: sortedRows[rowIdx[0] ?? 0]?.key ?? '',
      });
    } else {
      for (const r of rowIdx) {
        held.push({
          rowKey: sortedRows[r]?.key ?? '',
          pendingIds: (candidates.get(r) ?? []).map((e) => entries[e]?.id ?? '').sort(byText),
        });
      }
    }
  }

  // Apply the user's choices. A choice counts only if it names a real candidate and no other
  // choice claims the same entry; otherwise the row stays ambiguous.
  const choices = options.choices ?? new Map<string, string>();
  const claims = new Map<string, number>();
  for (const h of held) {
    const choice = choices.get(h.rowKey);
    if (choice !== undefined && h.pendingIds.includes(choice)) {
      claims.set(choice, (claims.get(choice) ?? 0) + 1);
    }
  }
  const ambiguous: { rowKey: string; pendingIds: string[] }[] = [];
  for (const h of held) {
    const choice = choices.get(h.rowKey);
    if (choice === 'new') newRows.push(h.rowKey);
    else if (choice !== undefined && h.pendingIds.includes(choice) && claims.get(choice) === 1) {
      merges.push({ pendingId: choice, rowKey: h.rowKey });
    } else ambiguous.push(h);
  }

  const merged = new Set(merges.map((m) => m.pendingId));
  return {
    merges: merges.sort((a, b) => byText(a.rowKey, b.rowKey)),
    newRows: newRows.sort(byText),
    ambiguous: ambiguous.sort((a, b) => byText(a.rowKey, b.rowKey)),
    stillPending: inAccount
      .filter((p) => !merged.has(p.id))
      .map((p) => p.id)
      .sort(byText),
  };
}

export interface PendingDuplicates {
  /** An SMS-captured entry that is the same payment as a manual one: keep the manual (it has the category/memo). */
  readonly merges: { readonly keepId: string; readonly dropId: string }[];
  /** Groups of entries that could be the same payment but cannot be paired without guessing. */
  readonly ambiguous: { readonly ids: string[] }[];
}

/**
 * Same payment logged twice before any statement exists: once from an SMS, once by hand.
 * Two manual entries are never merged (two real ₹20 chais), nor two SMS entries.
 */
export function findPendingDuplicates(
  entries: readonly PendingEntry[],
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): PendingDuplicates {
  const eligible = entries.filter((e) => e.method !== 'cash').sort((a, b) => byText(a.id, b.id));
  const edges: [number, number][] = [];
  eligible.forEach((a, i) => {
    eligible.forEach((b, j) => {
      if (
        i < j &&
        a.source !== b.source &&
        a.accountId === b.accountId &&
        a.method === b.method &&
        amountsClose(a.amount, b.amount, options) &&
        datesClose(a.date, b.date, options)
      ) {
        edges.push([i, j]);
      }
    });
  });

  const merges: { keepId: string; dropId: string }[] = [];
  const ambiguous: { ids: string[] }[] = [];
  const linked = new Set(edges.flat());
  for (const group of components(eligible.length, edges)) {
    if (!group.some((n) => linked.has(n))) continue;
    const members = group.map((n) => eligible[n]).filter((e): e is PendingEntry => e !== undefined);
    const manual = members.filter((e) => e.source === 'manual');
    const sms = members.filter((e) => e.source === 'sms');
    if (
      manual.length === 1 &&
      sms.length === 1 &&
      manual[0] !== undefined &&
      sms[0] !== undefined
    ) {
      merges.push({ keepId: manual[0].id, dropId: sms[0].id });
    } else {
      ambiguous.push({ ids: members.map((e) => e.id).sort(byText) });
    }
  }
  return {
    merges: merges.sort((a, b) => byText(a.keepId, b.keepId)),
    ambiguous: ambiguous.sort((a, b) => byText(a.ids.join(), b.ids.join())),
  };
}
