import type { LocalDate } from '@ledger/core';
import type { BundleView, ReconcileTxView, ReconcileView, UnmatchedReason } from '../api/models';

/** A set of payments that cancel each other out, ready to show. */
export interface BundleGroup {
  readonly bundle: BundleView;
  /** The payments in it, oldest first. */
  readonly rows: readonly ReconcileTxView[];
  /** The latest date in the group. */
  readonly date: LocalDate;
  /** True for more than a purchase and one refund: several that match in any order. */
  readonly interchangeable: boolean;
}

/** Payments that could be matched several ways, shown together as the one puzzle they are. */
export interface ReviewCluster {
  readonly reason: UnmatchedReason;
  readonly rows: readonly ReconcileTxView[];
  readonly date: LocalDate;
}

const byDateThenId = (a: ReconcileTxView, b: ReconcileTxView): number =>
  a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date);

const latest = (rows: readonly ReconcileTxView[]): LocalDate | null =>
  rows.reduce<LocalDate | null>(
    (max, row) => (max === null || row.date > max ? row.date : max),
    null,
  );

/**
 * The bundles with their payments filled in. Ones that need a look (names differ) come first, then
 * the settled ones, each newest first. A payment the API did not describe is left out of its rows.
 */
export function bundleGroups(view: ReconcileView): BundleGroup[] {
  const groups: BundleGroup[] = [];
  for (const bundle of view.bundles) {
    const rows = bundle.txIds
      .map((id) => view.transactions.get(id))
      .filter((row): row is ReconcileTxView => row !== undefined)
      .sort(byDateThenId);
    const date = latest(rows);
    if (date === null) continue;
    groups.push({ bundle, rows, date, interchangeable: bundle.txIds.length > 2 });
  }
  return groups.sort((a, b) => {
    if (a.bundle.status !== b.bundle.status) return a.bundle.status === 'open' ? -1 : 1;
    return a.date === b.date
      ? a.bundle.id.localeCompare(b.bundle.id)
      : b.date.localeCompare(a.date);
  });
}

/**
 * Review items that point at each other belong to one question ("which refund was which?"), so
 * they are joined into one cluster instead of being listed once per payment.
 */
export function reviewClusters(view: ReconcileView): ReviewCluster[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    for (
      let next = parent.get(root);
      next !== undefined && next !== root;
      next = parent.get(root)
    ) {
      root = next;
    }
    parent.set(id, root);
    return root;
  };
  const join = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };
  for (const item of view.unmatched) {
    if (!parent.has(item.txId)) parent.set(item.txId, item.txId);
    for (const other of item.relatedTxIds) {
      if (!parent.has(other)) parent.set(other, other);
      join(item.txId, other);
    }
  }

  const reasons = new Map<string, UnmatchedReason>();
  for (const item of view.unmatched) {
    const root = find(item.txId);
    if (!reasons.has(root)) reasons.set(root, item.reason);
  }
  const members = new Map<string, ReconcileTxView[]>();
  for (const id of parent.keys()) {
    const row = view.transactions.get(id);
    if (row === undefined) continue;
    const root = find(id);
    members.set(root, [...(members.get(root) ?? []), row]);
  }

  const clusters: ReviewCluster[] = [];
  for (const [root, reason] of reasons) {
    const rows = (members.get(root) ?? []).sort(byDateThenId);
    const date = latest(rows);
    if (date !== null) clusters.push({ reason, rows, date });
  }
  return clusters.sort((a, b) =>
    a.date === b.date
      ? (a.rows[0]?.id ?? '').localeCompare(b.rows[0]?.id ?? '')
      : b.date.localeCompare(a.date),
  );
}
