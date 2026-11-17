import { Injectable, computed, inject, signal } from '@angular/core';
import { nextDueDate, negatePaise } from '@ledger/core';
import type { LocalDate, Paise } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import type { FreeResult } from '../api/api-client';
import type { AccountBalanceView, ForecastView, PotView, ScheduledView } from '../api/models';
import { todayFromPayday } from '../format';
import { occurrencesUntil } from './schedule';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CardDue {
  readonly accountId: string;
  readonly name: string;
  readonly owedPaise: Paise;
  readonly nextDue: LocalDate;
}

export interface BalanceEntry {
  readonly accountId: string;
  readonly amountPaise: Paise;
}

const message = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback;

/** Everything the Dashboard shows, loaded together and held as signals. */
@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly api = inject(ApiClient);

  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<string | null>(null);

  readonly free = signal<FreeResult | null>(null);
  readonly forecast = signal<ForecastView | null>(null);
  readonly pots = signal<readonly PotView[]>([]);
  readonly scheduled = signal<readonly ScheduledView[]>([]);
  readonly balances = signal<readonly AccountBalanceView[]>([]);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  /** The free-to-spend answer, when every account has a balance. */
  readonly view = computed(() => {
    const free = this.free();
    return free?.kind === 'ready' ? free.free : null;
  });

  /** Accounts still waiting for a first balance, when free-to-spend cannot be worked out yet. */
  readonly missing = computed(() => {
    const free = this.free();
    return free?.kind === 'missing-balances' ? free.accounts : null;
  });

  /** The server's today, from its own payday arithmetic. Null until free-to-spend is known. */
  readonly today = computed(() => {
    const view = this.view();
    return view === null ? null : todayFromPayday(view.nextPayday, view.daysToPayday);
  });

  /** Cards with money owed, and when the next bill is due. */
  readonly cardDues = computed<CardDue[]>(() => {
    const today = this.today();
    if (today === null) return [];
    return this.balances().flatMap((b) =>
      b.kind === 'card' && b.cycle !== null && b.balancePaise !== null && b.balancePaise < 0
        ? [
            {
              accountId: b.accountId,
              name: b.name,
              owedPaise: negatePaise(b.balancePaise),
              nextDue: nextDueDate(today, b.cycle),
            },
          ]
        : [],
    );
  });

  /** Scheduled outflows that fall due before payday: what was deducted from free-to-spend. */
  readonly upcoming = computed(() => {
    const view = this.view();
    const today = this.today();
    if (view === null || today === null) return [];
    return occurrencesUntil(this.scheduled(), today, view.nextPayday);
  });

  async load(): Promise<void> {
    this.status.set('loading');
    this.error.set(null);
    try {
      const [free, balances, pots, scheduled] = await Promise.all([
        this.api.free(),
        this.api.balances(),
        this.api.pots(),
        this.api.scheduled(),
      ]);
      const forecast = free.kind === 'ready' ? await this.api.forecast() : null;
      this.free.set(free);
      this.balances.set(balances);
      this.pots.set(pots);
      this.scheduled.set(scheduled);
      this.forecast.set(forecast);
      this.status.set('ready');
    } catch (error) {
      this.error.set(message(error, 'Could not load the dashboard'));
      this.status.set('error');
    }
  }

  /** Records each balance, then reloads so every number reflects them. */
  async saveBalances(entries: readonly BalanceEntry[]): Promise<boolean> {
    this.saving.set(true);
    this.saveError.set(null);
    try {
      for (const entry of entries) {
        await this.api.recordBalance(entry.accountId, entry.amountPaise);
      }
    } catch (error) {
      this.saveError.set(
        error instanceof ApiError && error.status === 403
          ? 'This token can only read. Connect with a full-access token to record balances.'
          : message(error, 'Could not save the balances'),
      );
      return false;
    } finally {
      this.saving.set(false);
    }
    await this.load();
    return true;
  }
}
