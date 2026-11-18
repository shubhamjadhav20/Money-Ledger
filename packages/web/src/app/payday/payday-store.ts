import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import type { Paise, PaydayRule } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import type { ScheduledInput, SettingsChange } from '../api/api-client';
import type {
  PaydayOutcomeView,
  PaydayRuleView,
  PaydaySplitView,
  PotView,
  ScheduledView,
  SettingsView,
} from '../api/models';

export type LoadState = 'loading' | 'ready' | 'error';

/** Which card on the page a failure belongs to. */
export type Section = 'settings' | 'rules' | 'run' | 'scheduled';

/** One new id per payday run. Replaced in specs so the id is known. */
export const NEW_RUN_ID = new InjectionToken<() => string>('NEW_RUN_ID', {
  providedIn: 'root',
  factory: () => () => crypto.randomUUID(),
});

/** A salary that has been split on screen but not yet put into the pots. */
export interface Preview {
  readonly amountPaise: Paise;
  readonly split: PaydaySplitView;
  /** Sent with the apply. Using it twice changes nothing, so a retry after a dropped reply is safe. */
  readonly runId: string;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return 'Changing this needs a full-access token. Connect with one to make changes.';
    }
    return error.message;
  }
  return 'Something went wrong';
}

/** The Payday page: settings, the split, a payday run and the scheduled list. Belongs to the screen. */
@Injectable()
export class PaydayStore {
  private readonly api = inject(ApiClient);
  private readonly newRunId = inject(NEW_RUN_ID);

  readonly state = signal<LoadState>('loading');
  readonly error = signal<string | null>(null);
  readonly settings = signal<SettingsView | null>(null);
  readonly rules = signal<readonly PaydayRuleView[]>([]);
  readonly pots = signal<readonly PotView[]>([]);
  readonly scheduled = signal<readonly ScheduledView[]>([]);

  readonly preview = signal<Preview | null>(null);
  readonly applied = signal<PaydayOutcomeView | null>(null);

  readonly saving = signal(false);
  readonly failure = signal<{ readonly section: Section; readonly message: string } | null>(null);

  private latest = 0;

  /** `quiet` keeps what is on screen while the newer answer loads (after a change). */
  async load(quiet = false): Promise<void> {
    const ticket = ++this.latest;
    if (!quiet) this.state.set('loading');
    try {
      const [settings, rules, pots, scheduled] = await Promise.all([
        this.api.settings(),
        this.api.paydayRules(),
        this.api.pots(),
        this.api.scheduled(),
      ]);
      if (ticket !== this.latest) return;
      this.settings.set(settings);
      this.rules.set(rules);
      this.pots.set(pots);
      this.scheduled.set(scheduled);
      this.error.set(null);
      this.state.set('ready');
    } catch (error) {
      if (ticket !== this.latest) return;
      this.error.set(describe(error));
      if (!quiet) this.state.set('error');
    }
  }

  /** The failure message for one card, or null when it is another card's (or none). */
  failureFor(section: Section): string | null {
    const current = this.failure();
    return current?.section === section ? current.message : null;
  }

  clearFailure(): void {
    this.failure.set(null);
  }

  /** Runs one change at a time; true when it worked. On failure the reason is kept for its card. */
  private async change(section: Section, work: () => Promise<unknown>): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    this.failure.set(null);
    try {
      await work();
      return true;
    } catch (error) {
      this.failure.set({ section, message: describe(error) });
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  saveSettings(change: SettingsChange): Promise<boolean> {
    return this.change('settings', async () => {
      this.settings.set(await this.api.updateSettings(change));
    });
  }

  saveRules(rules: readonly PaydayRule[]): Promise<boolean> {
    return this.change('rules', async () => {
      this.rules.set(await this.api.setPaydayRules(rules));
      // The numbers on screen were worked out with the old rules.
      this.preview.set(null);
    });
  }

  /** Works out the split for a salary with the saved rules. Changes nothing on the server. */
  previewSalary(amountPaise: Paise): Promise<boolean> {
    return this.change('run', async () => {
      const split = await this.api.previewPayday(amountPaise);
      this.applied.set(null);
      this.preview.set({ amountPaise, split, runId: this.newRunId() });
    });
  }

  discardPreview(): void {
    this.preview.set(null);
    this.failure.update((current) => (current?.section === 'run' ? null : current));
  }

  /** Puts the previewed split into the pots. Safe to repeat: the run id makes a second try a no-op. */
  applyPreview(): Promise<boolean> {
    const preview = this.preview();
    if (preview === null) return Promise.resolve(false);
    return this.change('run', async () => {
      const outcome = await this.api.applyPayday({
        runId: preview.runId,
        amountPaise: preview.amountPaise,
      });
      this.applied.set(outcome);
      this.preview.set(null);
      await this.load(true);
    });
  }

  dismissApplied(): void {
    this.applied.set(null);
  }

  addScheduled(input: ScheduledInput): Promise<boolean> {
    return this.change('scheduled', async () => {
      await this.api.addScheduled(input);
      await this.load(true);
    });
  }

  removeScheduled(id: string): Promise<boolean> {
    return this.change('scheduled', async () => {
      await this.api.deleteScheduled(id);
      await this.load(true);
    });
  }
}
