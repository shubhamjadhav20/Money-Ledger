import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TX_KINDS } from '@ledger/core';
import type { TxKind } from '@ledger/core';
import type { TransactionChange } from '../api/api-client';
import type { TransactionView } from '../api/models';
import { UiButton } from '../ui/button';
import { KIND_HELP, KIND_LABELS } from './labels';

/**
 * Changes the two things a transaction may change: its category and its kind. Only what actually
 * changed is sent; a blank category clears it. Amount, date and counterparty come from the bank
 * and are never editable here.
 */
@Component({
  selector: 'app-transaction-editor',
  imports: [UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transaction-editor.html',
  styleUrl: './transaction-editor.css',
})
export class TransactionEditor {
  readonly tx = input.required<TransactionView>();
  /** Category names already in use, offered as suggestions so spelling stays consistent. */
  readonly suggestions = input<readonly string[]>([]);
  readonly saving = input(false);
  readonly failure = input<string | null>(null);
  readonly save = output<TransactionChange>();
  readonly cancel = output();

  protected readonly kinds = TX_KINDS;
  protected readonly kindLabels = KIND_LABELS;

  private readonly typedCategory = signal<string | null>(null);
  private readonly pickedKind = signal<TxKind | null>(null);

  protected readonly category = computed(() => this.typedCategory() ?? this.tx().category ?? '');
  protected readonly kind = computed(() => this.pickedKind() ?? this.tx().kind);
  protected readonly kindHelp = computed(() => KIND_HELP[this.kind()]);

  protected onCategory(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.typedCategory.set(event.target.value);
  }

  protected onKind(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    const picked = TX_KINDS.find((k) => k === value);
    if (picked !== undefined) this.pickedKind.set(picked);
  }

  protected submit(): void {
    const tx = this.tx();
    const category = this.category().trim();
    const nextCategory = category === '' ? null : category;
    const change: { category?: string | null; kind?: TxKind } = {};
    if (nextCategory !== tx.category) change.category = nextCategory;
    if (this.kind() !== tx.kind) change.kind = this.kind();
    if (Object.keys(change).length === 0) this.cancel.emit();
    else this.save.emit(change);
  }
}
