import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { negatePaise } from '@ledger/core';
import type { Paise } from '@ledger/core';
import type { ElementRef, Signal } from '@angular/core';
import type { CapturedView } from '../api/models';
import { formatDay } from '../format';
import { STATUS_LABELS, METHOD_LABELS } from '../transactions/labels';
import { UiButton } from '../ui/button';
import { UiCard } from '../ui/card';
import { UiChip } from '../ui/chip';
import { UiMoney } from '../ui/money';
import { DAYS, DIRECTIONS, METHODS } from './compose';
import { QuickAddStore } from './quick-add-store';

const DAY_LABELS = { today: 'Today', yesterday: 'Yesterday' } as const;
const DIRECTION_LABELS = { spent: 'Spent', received: 'Received' } as const;

/** Reads the value out of an input event without trusting the event's type. */
function typed(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement
    ? target.value
    : '';
}

@Component({
  selector: 'app-quick-add',
  imports: [UiButton, UiCard, UiChip, UiMoney],
  providers: [QuickAddStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quick-add.html',
  styleUrl: './quick-add.css',
})
export class QuickAdd {
  protected readonly store = inject(QuickAddStore);
  private readonly amountField: Signal<ElementRef<HTMLInputElement>> =
    viewChild.required('amountField');

  protected readonly directions = DIRECTIONS;
  protected readonly directionLabels = DIRECTION_LABELS;
  protected readonly methods = METHODS;
  protected readonly methodLabels = METHOD_LABELS;
  protected readonly days = DAYS;
  protected readonly dayLabels = DAY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly formatDay = formatDay;
  protected readonly typed = typed;

  /** Said aloud once an entry is saved (the list below changes silently for a screen reader). */
  protected readonly announcement = signal('');

  constructor() {
    void this.store.loadAccounts();
  }

  protected async save(): Promise<void> {
    if (!(await this.store.save())) return;
    this.announcement.set(`Added ${this.describe(this.store.added()[0])}`);
    this.amountField().nativeElement.focus();
  }

  /** The amount without its sign: "Spent" and "Received" already say which way it went. */
  protected magnitude(amount: Paise): Paise {
    return amount < 0 ? negatePaise(amount) : amount;
  }

  protected describe(item: CapturedView | undefined): string {
    if (item === undefined) return '';
    const what = item.kind === 'income' ? 'received' : 'spent';
    return `${what} on ${item.category}, ${METHOD_LABELS[item.method]}, pending`;
  }
}
