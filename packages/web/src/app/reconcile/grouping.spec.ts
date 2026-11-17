import { paise, parseLocalDate } from '@ledger/core';
import { decodeReconcile } from '../api/models';
import type { ReconcileView } from '../api/models';
import { RECONCILE, RECONCILE_JSON } from '../../testing-api';
import { must } from '../../testing';
import { bundleGroups, reviewClusters } from './grouping';

const empty = (over: Partial<ReconcileView> = {}): ReconcileView => ({
  ...RECONCILE,
  bundles: [],
  unmatched: [],
  singleCount: 0,
  transactions: new Map(),
  ...over,
});

describe('bundleGroups', () => {
  it('puts the ones to check first, then the settled ones, newest first within each', () => {
    const groups = bundleGroups(RECONCILE);
    expect(groups.map((g) => [g.bundle.status, g.date])).toEqual([
      ['open', '2026-11-14'],
      ['open', '2026-11-10'],
      ['settled', '2026-11-05'],
    ]);
  });

  it('lists each group’s payments oldest first and marks the several-in-any-order group', () => {
    const [group, pair] = bundleGroups(RECONCILE);
    expect(must(group).interchangeable).toBe(true);
    expect(must(group).rows).toHaveLength(4);
    expect(must(pair).interchangeable).toBe(false);
    expect(must(pair).rows.map((r) => r.id)).toEqual(['t-dinner', 't-friend']);
  });

  it('leaves out a payment the server did not describe, and a bundle with none described', () => {
    const transactions = new Map(RECONCILE.transactions);
    transactions.delete('t-refund');
    for (const id of ['t-dinner', 't-friend']) transactions.delete(id);
    const groups = bundleGroups({ ...RECONCILE, transactions });
    expect(groups.map((g) => g.bundle.id)).toEqual([
      'bundle:t-g1+t-g2+t-g3+t-g4',
      'bundle:t-flight+t-refund',
    ]);
    expect(groups.at(-1)?.rows.map((r) => r.id)).toEqual(['t-flight']);
  });

  it('orders groups on the same day the same way every time', () => {
    const twin = decodeReconcile({
      ...RECONCILE_JSON,
      bundles: [...RECONCILE_JSON.bundles].reverse(),
    });
    expect(bundleGroups(twin).map((g) => g.bundle.id)).toEqual(
      bundleGroups(RECONCILE).map((g) => g.bundle.id),
    );
  });

  it('has nothing for an empty month', () => {
    expect(bundleGroups(empty())).toEqual([]);
  });
});

describe('reviewClusters', () => {
  it('joins payments that point at each other into one cluster, oldest first', () => {
    const clusters = reviewClusters(RECONCILE);
    expect(clusters).toHaveLength(1);
    const [cluster] = clusters;
    expect(must(cluster).reason).toBe('ambiguous');
    expect(must(cluster).rows.map((r) => r.id)).toEqual(['t-a', 't-b', 't-c']);
    expect(must(cluster).date).toBe('2026-11-13');
  });

  it('keeps separate puzzles apart and lists the newest first', () => {
    const tx = (id: string, date: string) => ({
      id,
      accountId: 'acc-bank',
      date: parseLocalDate(date, 'yyyy-mm-dd'),
      amountPaise: paise(-100),
      counterparty: id,
    });
    const view = empty({
      unmatched: [
        { txId: 'x1', reason: 'ambiguous', relatedTxIds: ['x2'] },
        { txId: 'y1', reason: 'group-too-large', relatedTxIds: ['y2'] },
      ],
      transactions: new Map([
        ['x1', tx('x1', '2026-11-02')],
        ['x2', tx('x2', '2026-11-03')],
        ['y1', tx('y1', '2026-11-20')],
        ['y2', tx('y2', '2026-11-21')],
      ]),
    });
    expect(reviewClusters(view).map((c) => [c.reason, c.rows.map((r) => r.id)])).toEqual([
      ['group-too-large', ['y1', 'y2']],
      ['ambiguous', ['x1', 'x2']],
    ]);
  });

  it('shows only the payments it can describe, and nothing for a cluster it can describe none of', () => {
    const view = empty({
      unmatched: [{ txId: 'ghost', reason: 'ambiguous', relatedTxIds: ['ghost-2'] }],
    });
    expect(reviewClusters(view)).toEqual([]);
    const partial = reviewClusters({
      ...RECONCILE,
      transactions: new Map([...RECONCILE.transactions].filter(([id]) => id !== 't-c')),
    });
    expect(must(partial[0]).rows.map((r) => r.id)).toEqual(['t-a', 't-b']);
  });

  it('has nothing for an empty month', () => {
    expect(reviewClusters(empty())).toEqual([]);
  });
});
