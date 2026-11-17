import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient, ApiError } from '../api/api-client';
import type { PotChange, PotInput, PotMovementInput } from '../api/api-client';
import type { AccountBalanceView, PotMovementView, PotView } from '../api/models';

export type LoadState = 'loading' | 'ready' | 'error';

export interface History {
  readonly state: 'loading' | 'ready' | 'error';
  /** Newest first. */
  readonly items: readonly PotMovementView[];
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return 'Changing pots needs a full-access token. Connect with one to make changes.';
    }
    return error.message;
  }
  return 'Something went wrong';
}

/** The pots page: the list, plus every change you can make to a pot. Belongs to the screen. */
@Injectable()
export class PotsStore {
  private readonly api = inject(ApiClient);

  readonly state = signal<LoadState>('loading');
  readonly error = signal<string | null>(null);
  readonly pots = signal<readonly PotView[]>([]);
  private readonly accounts = signal<readonly AccountBalanceView[]>([]);
  readonly histories = signal<Readonly<Record<string, History>>>({});

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  /** Card accounts a bill pot can be set aside for. */
  readonly cards = computed(() => this.accounts().filter((a) => a.kind === 'card'));

  /** The name of the card a pot covers, when it covers one. */
  cardName(pot: PotView): string | null {
    if (pot.coversCardAccountId === null) return null;
    return this.accounts().find((a) => a.accountId === pot.coversCardAccountId)?.name ?? 'a card';
  }

  private latest = 0;

  /** `quiet` keeps what is on screen while the newer answer loads (after a change). */
  async load(quiet = false): Promise<void> {
    const ticket = ++this.latest;
    if (!quiet) this.state.set('loading');
    try {
      const [pots, accounts] = await Promise.all([this.api.pots(), this.api.balances()]);
      if (ticket !== this.latest) return;
      this.pots.set(pots);
      this.accounts.set(accounts);
      this.error.set(null);
      this.state.set('ready');
    } catch (error) {
      if (ticket !== this.latest) return;
      this.error.set(describe(error));
      if (!quiet) this.state.set('error');
    }
  }

  /** Runs one change; true when it worked. On failure the reason stays in `saveError`. */
  private async change(work: () => Promise<unknown>): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await work();
      return true;
    } catch (error) {
      this.saveError.set(describe(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  clearSaveError(): void {
    this.saveError.set(null);
  }

  create(input: PotInput): Promise<boolean> {
    return this.change(async () => {
      await this.api.createPot(input);
      await this.load(true);
    });
  }

  update(id: string, change: PotChange): Promise<boolean> {
    return this.change(async () => {
      await this.api.updatePot(id, change);
      await this.load(true);
    });
  }

  /** Puts money in or takes it out; the journal row is added and the balance re-read. */
  move(id: string, input: PotMovementInput): Promise<boolean> {
    return this.change(async () => {
      await this.api.addPotMovement(id, input);
      await this.load(true);
      if (this.histories()[id] !== undefined) await this.loadHistory(id);
    });
  }

  async loadHistory(id: string): Promise<void> {
    this.histories.update((all) => ({
      ...all,
      [id]: { state: 'loading', items: all[id]?.items ?? [] },
    }));
    try {
      const items = await this.api.potMovements(id);
      this.histories.update((all) => ({
        ...all,
        [id]: { state: 'ready', items: [...items].reverse() },
      }));
    } catch {
      this.histories.update((all) => ({
        ...all,
        [id]: { state: 'error', items: all[id]?.items ?? [] },
      }));
    }
  }
}
