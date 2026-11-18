import { Injectable, computed, inject, signal } from '@angular/core';
import { parseCapture } from '@ledger/core';
import type { CaptureResult, PaymentMethod } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import { AuthStore } from '../api/auth';
import type { AccountBalanceView, CapturedView } from '../api/models';
import { TODAY } from '../month';
import { composeCapture } from './compose';
import type { Day, Direction } from './compose';

/** How many saved entries the "Just added" list keeps. */
export const KEEP_ADDED = 5;

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return 'This token cannot add entries. Connect with a capture or full-access token.';
    }
    if (error.status === 429) return 'Too many entries too fast. Wait a minute and try again.';
    return error.message;
  }
  return 'Something went wrong';
}

/**
 * The quick-add screen: the form fields, a live read of them with the shared grammar, and the
 * save. It belongs to the screen. Nothing typed here is logged or stored outside this tab.
 */
@Injectable()
export class QuickAddStore {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly today = inject(TODAY);

  readonly direction = signal<Direction>('spent');
  readonly amount = signal('');
  readonly category = signal('');
  readonly note = signal('');
  readonly method = signal<PaymentMethod>('upi');
  readonly day = signal<Day>('today');
  /** An account id, or '' to let the server pick from the payment method. */
  readonly accountId = signal('');

  /** Accounts to choose from. Empty for a capture-only token, which cannot read them. */
  readonly accounts = signal<readonly AccountBalanceView[]>([]);

  readonly saving = signal(false);
  readonly failure = signal<string | null>(null);
  /** Saved this visit, newest first. This is also the only feedback a capture-only token gets. */
  readonly added = signal<readonly CapturedView[]>([]);

  /** The form as one line of the grammar: what is sent, exactly. */
  readonly text = computed(() =>
    composeCapture({
      direction: this.direction(),
      amount: this.amount(),
      category: this.category(),
      note: this.note(),
      method: this.method(),
      day: this.day(),
    }),
  );

  /** Nothing is read (or complained about) until something has been typed. */
  private readonly started = computed(
    () => this.amount().trim() !== '' || this.category().trim() !== '' || this.note().trim() !== '',
  );

  readonly reading = computed<CaptureResult | null>(() =>
    this.started() ? parseCapture(this.text(), { today: this.today }) : null,
  );

  readonly canSave = computed(() => this.reading()?.ok === true && !this.saving());

  /** Categories in the list above, most recent first and once each, to tap instead of typing. */
  readonly recentCategories = computed(() => [...new Set(this.added().map((i) => i.category))]);

  /** Loads accounts for the optional account choice. Quietly skipped when they cannot be read. */
  async loadAccounts(): Promise<void> {
    if (this.auth.captureOnly()) return;
    try {
      this.accounts.set(await this.api.balances());
    } catch {
      this.accounts.set([]);
    }
  }

  /** Saves the entry. True when it worked; on failure the reason stays in `failure`. */
  async save(): Promise<boolean> {
    if (!this.canSave()) return false;
    this.saving.set(true);
    this.failure.set(null);
    try {
      const saved = await this.api.capture(
        this.text(),
        this.accountId() === '' ? undefined : this.accountId(),
      );
      this.added.update((list) => [saved, ...list].slice(0, KEEP_ADDED));
      // Ready for the next one. The method, day and account stay: they tend to repeat.
      this.amount.set('');
      this.category.set('');
      this.note.set('');
      return true;
    } catch (error) {
      this.failure.set(describe(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
