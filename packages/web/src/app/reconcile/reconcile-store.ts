import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient, ApiError } from '../api/api-client';
import type { AccountBalanceView, ReconcileView } from '../api/models';
import { CURRENT_MONTH, monthRange, shiftMonth } from '../month';
import { bundleGroups, reviewClusters } from './grouping';

export type LoadStatus = 'loading' | 'ready' | 'error';

/** The Reconcile screen: one month of matched and unmatched payments. Reads only. */
@Injectable()
export class ReconcileStore {
  private readonly api = inject(ApiClient);
  private readonly thisMonth = inject(CURRENT_MONTH);

  readonly month = signal(this.thisMonth);
  readonly status = signal<LoadStatus>('loading');
  readonly error = signal<string | null>(null);
  readonly view = signal<ReconcileView | null>(null);
  private readonly accounts = signal<readonly AccountBalanceView[]>([]);

  readonly canGoForward = computed(() => this.month() < this.thisMonth);

  private readonly groups = computed(() => {
    const view = this.view();
    return view === null ? [] : bundleGroups(view);
  });
  /** Matches where the two names differ: only a suggestion, so they come with a "please check". */
  readonly toCheck = computed(() => this.groups().filter((g) => g.bundle.status === 'open'));
  readonly matched = computed(() => this.groups().filter((g) => g.bundle.status === 'settled'));
  readonly review = computed(() => {
    const view = this.view();
    return view === null ? [] : reviewClusters(view);
  });
  /** Payments inside the review clusters, for the summary count. */
  readonly reviewCount = computed(() => this.review().reduce((sum, c) => sum + c.rows.length, 0));
  readonly singleCount = computed(() => this.view()?.singleCount ?? 0);
  readonly nothingToMatch = computed(
    () => this.groups().length === 0 && this.review().length === 0,
  );

  private readonly accountNames = computed(
    () => new Map(this.accounts().map((a) => [a.accountId, a.name])),
  );

  accountName(accountId: string): string {
    return this.accountNames().get(accountId) ?? 'Unknown account';
  }

  private latest = 0;

  async load(): Promise<void> {
    const ticket = ++this.latest;
    this.status.set('loading');
    this.error.set(null);
    const { from, to } = monthRange(this.month());
    try {
      const [view, accounts] = await Promise.all([
        this.api.reconcile(from, to),
        this.api.balances(),
      ]);
      if (ticket !== this.latest) return;
      this.view.set(view);
      this.accounts.set(accounts);
      this.status.set('ready');
    } catch (error) {
      if (ticket !== this.latest) return;
      this.error.set(error instanceof ApiError ? error.message : 'Could not load this month');
      this.status.set('error');
    }
  }

  goToMonth(delta: number): Promise<void> {
    const next = shiftMonth(this.month(), delta);
    if (next > this.thisMonth) return Promise.resolve();
    this.month.set(next);
    return this.load();
  }
}
