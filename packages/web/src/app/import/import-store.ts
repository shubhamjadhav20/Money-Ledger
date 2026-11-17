import { Injectable, computed, inject, signal } from '@angular/core';
import { DEMO_MAPPINGS } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import type {
  AccountBalanceView,
  ImportAmbiguousView,
  ImportOutcomeView,
  ImportPlanView,
  TransactionView,
} from '../api/models';

export type ImportStep = 'choose' | 'review' | 'done';
export type ImportBusy = 'previewing' | 'confirming' | null;

/** The API refuses bigger files; checking here gives the message before a slow upload. */
export const MAX_CSV_CHARS = 2_000_000;

/**
 * The statement layouts the API accepts. They come from core, the same list the API defaults to, so
 * the two cannot disagree. A real bank layout is added there (config only).
 */
export const LAYOUTS = DEMO_MAPPINGS.map((mapping) => ({ id: mapping.id, label: mapping.label }));

/** A pending entry that could be a statement row, with its details when they are known. */
export interface Candidate {
  readonly id: string;
  readonly entry: TransactionView | null;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return 'Importing needs a full-access token. Connect with one to import.';
    }
    if (error.status === 413) return 'That file is too large to import.';
    return error.message;
  }
  return 'Something went wrong';
}

/**
 * One import, start to finish: pick account, layout and file, preview what would happen, settle any
 * row that could be more than one of your entries, then confirm. The file's text lives only in this
 * store, which belongs to the screen, so leaving the screen forgets it.
 */
@Injectable()
export class ImportStore {
  private readonly api = inject(ApiClient);

  readonly layouts = LAYOUTS;

  readonly step = signal<ImportStep>('choose');
  readonly busy = signal<ImportBusy>(null);
  readonly error = signal<string | null>(null);

  readonly accounts = signal<readonly AccountBalanceView[]>([]);
  readonly accountsState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly accountId = signal('');
  readonly mappingId = signal('');

  readonly fileName = signal<string | null>(null);
  readonly fileError = signal<string | null>(null);
  private readonly csv = signal<string | null>(null);

  readonly plan = signal<ImportPlanView | null>(null);
  readonly choices = signal<Readonly<Record<string, string>>>({});
  readonly outcome = signal<ImportOutcomeView | null>(null);

  private readonly pending = signal<ReadonlyMap<string, TransactionView>>(new Map());
  /** Every row that has needed a decision, kept so a decision can still be changed once made. */
  private readonly seenAmbiguous = signal<readonly ImportAmbiguousView[]>([]);

  /** Statements come from bank, savings and card accounts, never cash. */
  readonly statementAccounts = computed(() =>
    this.accounts().filter((account) => account.kind !== 'cash'),
  );

  readonly accountName = computed(
    () =>
      this.accounts().find((account) => account.accountId === this.accountId())?.name ?? 'account',
  );

  readonly canPreview = computed(
    () =>
      this.accountId() !== '' &&
      this.mappingId() !== '' &&
      this.csv() !== null &&
      this.busy() === null,
  );

  readonly importCount = computed(() => {
    const plan = this.plan();
    return plan === null ? 0 : plan.toInsert.length + plan.merges.length;
  });

  readonly undecided = computed(() => this.plan()?.ambiguous.length ?? 0);

  readonly canConfirm = computed(() => {
    const plan = this.plan();
    return (
      plan !== null && plan.issues.length === 0 && this.importCount() > 0 && this.busy() === null
    );
  });

  /** Rows to show in the picker: every row that has needed a decision, in file order. */
  readonly decisions = computed(() =>
    [...this.seenAmbiguous()].sort((a, b) => a.line - b.line || a.rowKey.localeCompare(b.rowKey)),
  );

  /** Rows whose choice cannot be honoured because another row picked the same entry. */
  readonly conflicts = computed(() => {
    const picked = this.choices();
    return new Set(
      (this.plan()?.ambiguous ?? [])
        .filter((row) => picked[row.rowKey] !== undefined)
        .map((row) => row.rowKey),
    );
  });

  /** The entry for a pending id, or null when it is unknown (it may have been changed meanwhile). */
  entry(pendingId: string): TransactionView | null {
    return this.pending().get(pendingId) ?? null;
  }

  candidates(row: ImportAmbiguousView): Candidate[] {
    return row.pendingIds.map((id) => ({ id, entry: this.entry(id) }));
  }

  private latest = 0;

  async loadAccounts(): Promise<void> {
    this.accountsState.set('loading');
    try {
      this.accounts.set(await this.api.balances());
      this.accountsState.set('ready');
    } catch {
      this.accountsState.set('error');
    }
  }

  setAccount(id: string): void {
    this.accountId.set(id);
  }

  setLayout(id: string): void {
    this.mappingId.set(id);
  }

  /** `text` is the file's contents; reading the file is the caller's job. */
  setFile(name: string, text: string): void {
    this.fileError.set(null);
    if (text.trim() === '') {
      this.clearFile();
      this.fileError.set('That file is empty.');
    } else if (text.length > MAX_CSV_CHARS) {
      this.clearFile();
      this.fileError.set('That file is too large to import.');
    } else {
      this.fileName.set(name);
      this.csv.set(text);
    }
  }

  failFile(message: string): void {
    this.clearFile();
    this.fileError.set(message);
  }

  private clearFile(): void {
    this.fileName.set(null);
    this.csv.set(null);
  }

  async preview(): Promise<void> {
    if (!this.canPreview()) return;
    this.choices.set({});
    this.seenAmbiguous.set([]);
    await this.runPreview();
  }

  /** Records a decision for one row, then re-plans so the numbers reflect it. */
  async choose(rowKey: string, value: string): Promise<void> {
    this.choices.update((current) => ({ ...current, [rowKey]: value }));
    await this.runPreview();
  }

  private request() {
    const csv = this.csv();
    if (csv === null) throw new Error('No file chosen');
    const choices = this.choices();
    return {
      accountId: this.accountId(),
      mappingId: this.mappingId(),
      csv,
      ...(Object.keys(choices).length === 0 ? {} : { choices }),
    };
  }

  private async runPreview(): Promise<void> {
    const ticket = ++this.latest;
    this.busy.set('previewing');
    this.error.set(null);
    try {
      const plan = await this.api.previewImport(this.request());
      if (ticket !== this.latest) return;
      await this.loadPending(plan);
      if (ticket !== this.latest) return;
      this.plan.set(plan);
      this.seenAmbiguous.update((seen) => {
        const known = new Set(seen.map((row) => row.rowKey));
        return [...seen, ...plan.ambiguous.filter((row) => !known.has(row.rowKey))];
      });
      this.step.set('review');
    } catch (error) {
      if (ticket !== this.latest) return;
      this.error.set(describe(error));
    } finally {
      if (ticket === this.latest) this.busy.set(null);
    }
  }

  /** The plan names entries by id only; fetch the details once so the screen can show them. */
  private async loadPending(plan: ImportPlanView): Promise<void> {
    const wanted = [
      ...plan.merges.map((m) => m.pendingId),
      ...plan.ambiguous.flatMap((a) => a.pendingIds),
    ];
    if (wanted.every((id) => this.pending().has(id))) return;
    const entries = await this.api.transactions({ status: 'pending', limit: 200 });
    this.pending.set(new Map(entries.map((entry) => [entry.id, entry])));
  }

  async confirm(): Promise<void> {
    if (!this.canConfirm()) return;
    const ticket = ++this.latest;
    this.busy.set('confirming');
    this.error.set(null);
    try {
      const outcome = await this.api.confirmImport(this.request());
      this.outcome.set(outcome);
      this.step.set('done');
      this.clearFile();
      this.plan.set(null);
      this.choices.set({});
      this.seenAmbiguous.set([]);
    } catch (error) {
      this.error.set(describe(error));
    } finally {
      if (ticket === this.latest) this.busy.set(null);
    }
  }

  /** Back to choosing a file, keeping the account and layout. */
  chooseAnother(): void {
    this.latest += 1;
    this.clearFile();
    this.fileError.set(null);
    this.plan.set(null);
    this.choices.set({});
    this.seenAmbiguous.set([]);
    this.outcome.set(null);
    this.error.set(null);
    this.busy.set(null);
    this.step.set('choose');
  }
}
