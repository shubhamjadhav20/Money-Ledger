import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TX_KINDS } from '@ledger/core';
import type { TransactionChange } from '../api/api-client';
import type { TransactionView } from '../api/models';
import { formatDay, plural } from '../format';
import { formatMonth } from '../month';
import { UiBadge } from '../ui/badge';
import { UiButton } from '../ui/button';
import { UiIcon } from '../ui/icon';
import { UiCard } from '../ui/card';
import { UiMoney } from '../ui/money';
import { UiStateMessage } from '../ui/state-message';
import { KIND_LABELS, METHOD_LABELS, STATUS_LABELS } from './labels';
import { TransactionEditor } from './transaction-editor';
import { TransactionsStore } from './transactions-store';
import type { KindFilter, StatusFilter } from './transactions-store';

@Component({
  selector: 'app-transactions',
  imports: [TransactionEditor, UiBadge, UiButton, UiCard, UiMoney, UiStateMessage, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transactions.html',
  styleUrl: './transactions.css',
})
export class Transactions {
  protected readonly store = inject(TransactionsStore);

  protected readonly editingId = signal<string | null>(null);

  protected readonly monthLabel = computed(() => formatMonth(this.store.month()));
  protected readonly kinds = TX_KINDS;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly methodLabels = METHOD_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly formatDay = formatDay;
  protected readonly plural = plural;

  constructor() {
    void this.store.load();
  }

  protected reload(): void {
    void this.store.load();
  }

  protected search(text: string): void {
    void this.store.applySearch(text);
  }

  protected onStatus(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    if (value === 'all' || value === 'pending' || value === 'posted') {
      void this.store.setStatus(value satisfies StatusFilter);
    }
  }

  protected onKind(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    const picked = TX_KINDS.find((kind) => kind === value);
    this.store.setKind((picked ?? 'all') satisfies KindFilter);
  }

  protected edit(tx: TransactionView): void {
    this.store.saveError.set(null);
    this.editingId.set(tx.id);
  }

  protected async save(tx: TransactionView, change: TransactionChange): Promise<void> {
    if (await this.store.update(tx.id, change)) this.editingId.set(null);
  }

  /** What to call a row: the counterparty, else the memo, else a plain placeholder. */
  protected title(tx: TransactionView): string {
    if (tx.counterparty !== '') return tx.counterparty;
    return tx.memo !== '' ? tx.memo : 'No description';
  }
}
