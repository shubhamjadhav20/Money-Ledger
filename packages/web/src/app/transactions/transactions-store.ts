import { Injectable, computed, inject, signal } from '@angular/core';
import { UNCATEGORISED } from '@ledger/core';
import type { TxKind } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import type { TransactionChange } from '../api/api-client';
import type { AccountBalanceView, SummaryView, TransactionView, TxStatus } from '../api/models';
import { CURRENT_MONTH, monthRange, shiftMonth } from '../month';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type StatusFilter = 'all' | TxStatus;
export type KindFilter = 'all' | TxKind;

/** The most rows asked for in one go; when that many come back there may be more. */
export const PAGE_LIMIT = 200;
const TOP_CATEGORIES = 8;

const message = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback;

/** The Transactions screen: one month at a time, with search and filters, and category/kind edits. */
@Injectable({ providedIn: 'root' })
export class TransactionsStore {
  private readonly api = inject(ApiClient);
  private readonly thisMonth = inject(CURRENT_MONTH);

  readonly month = signal(this.thisMonth);
  readonly search = signal('');
  readonly statusFilter = signal<StatusFilter>('all');
  readonly kindFilter = signal<KindFilter>('all');

  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly TransactionView[]>([]);
  readonly summary = signal<SummaryView | null>(null);
  readonly accounts = signal<readonly AccountBalanceView[]>([]);

  /** The transaction being saved right now, if any. */
  readonly savingId = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);

  readonly canGoForward = computed(() => this.month() < this.thisMonth);

  readonly filtering = computed(
    () => this.search() !== '' || this.statusFilter() !== 'all' || this.kindFilter() !== 'all',
  );

  /** Rows after the kind filter (the API has no kind filter, so it is applied here). */
  readonly visible = computed(() => {
    const kind = this.kindFilter();
    return kind === 'all' ? this.rows() : this.rows().filter((row) => row.kind === kind);
  });

  /** True when the API may have more rows than were fetched. */
  readonly truncated = computed(() => this.rows().length >= PAGE_LIMIT);

  readonly topCategories = computed(
    () => this.summary()?.spendByCategory.slice(0, TOP_CATEGORIES) ?? [],
  );
  readonly moreCategories = computed(() =>
    Math.max(0, (this.summary()?.spendByCategory.length ?? 0) - TOP_CATEGORIES),
  );

  /** Category names already in use, so edits can reuse the exact same spelling. */
  readonly categoryNames = computed(() => {
    const names = new Set<string>();
    for (const row of this.rows()) if (row.category !== null) names.add(row.category);
    for (const item of this.summary()?.spendByCategory ?? []) names.add(item.category);
    names.delete(UNCATEGORISED);
    return [...names].sort((a, b) => a.localeCompare(b));
  });

  private readonly accountNames = computed(
    () => new Map(this.accounts().map((account) => [account.accountId, account.name])),
  );

  accountName(accountId: string): string {
    return this.accountNames().get(accountId) ?? 'Unknown account';
  }

  /** Answers that arrive after a newer request was made are dropped. */
  private latest = 0;

  /** `quiet` keeps what is on screen while refreshing (after an edit), instead of a loading state. */
  async load(options: { quiet?: boolean } = {}): Promise<void> {
    const ticket = ++this.latest;
    if (options.quiet !== true) this.status.set('loading');
    this.error.set(null);
    const { from, to } = monthRange(this.month());
    const status = this.statusFilter();
    try {
      const [rows, summary, accounts] = await Promise.all([
        this.api.transactions({
          from,
          to,
          limit: PAGE_LIMIT,
          ...(this.search() === '' ? {} : { search: this.search() }),
          ...(status === 'all' ? {} : { status }),
        }),
        this.api.summary(this.month()),
        this.api.balances(),
      ]);
      if (ticket !== this.latest) return;
      this.rows.set(rows);
      this.summary.set(summary);
      this.accounts.set(accounts);
      this.status.set('ready');
    } catch (error) {
      if (ticket !== this.latest) return;
      this.error.set(message(error, 'Could not load transactions'));
      this.status.set('error');
    }
  }

  goToMonth(delta: number): Promise<void> {
    const next = shiftMonth(this.month(), delta);
    if (next > this.thisMonth) return Promise.resolve();
    this.month.set(next);
    return this.load();
  }

  applySearch(text: string): Promise<void> {
    this.search.set(text.trim());
    return this.load();
  }

  setStatus(value: StatusFilter): Promise<void> {
    this.statusFilter.set(value);
    return this.load();
  }

  setKind(value: KindFilter): void {
    this.kindFilter.set(value);
  }

  clearFilters(): Promise<void> {
    this.search.set('');
    this.statusFilter.set('all');
    this.kindFilter.set('all');
    return this.load();
  }

  /** Changes a transaction's category and/or kind. Returns whether it was saved. */
  async update(id: string, change: TransactionChange): Promise<boolean> {
    this.savingId.set(id);
    this.saveError.set(null);
    try {
      const saved = await this.api.updateTransaction(id, change);
      this.rows.update((rows) => rows.map((row) => (row.id === id ? saved : row)));
    } catch (error) {
      this.saveError.set(
        error instanceof ApiError && error.status === 403
          ? 'This token can only read. Connect with a full-access token to edit transactions.'
          : message(error, 'Could not save the change'),
      );
      return false;
    } finally {
      this.savingId.set(null);
    }
    // The month's totals depend on kind and category, so refresh them without flashing the list.
    await this.load({ quiet: true });
    return true;
  }
}
