import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MoneyError, negatePaise, parseAmount } from '@ledger/core';
import type { Paise } from '@ledger/core';
import type { PotMovementInput } from '../api/api-client';
import type { PotView } from '../api/models';
import { UiButton } from '../ui/button';
import { UiMoney } from '../ui/money';

type Direction = 'in' | 'out';
type Reason = PotMovementInput['reason'];

const REASONS: readonly { readonly id: Reason; readonly label: string }[] = [
  { id: 'manual', label: 'Moved by hand' },
  { id: 'spend', label: 'Spent from the pot' },
  { id: 'trueup', label: 'Correction' },
];

/**
 * Puts money into a pot or takes it out. You type a plain amount and pick the direction; the sign
 * is added here, never typed. The pot's history only ever grows, so a mistake is fixed by making
 * the opposite move.
 */
@Component({
  selector: 'app-pot-move',
  imports: [UiButton, UiMoney],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pot-move.html',
  styleUrl: './pot-move.css',
})
export class PotMove {
  readonly pot = input.required<PotView>();
  readonly saving = input(false);
  readonly failure = input<string | null>(null);
  readonly move = output<PotMovementInput>();
  readonly cancel = output();

  protected readonly reasons = REASONS;
  protected readonly direction = signal<Direction>('in');
  protected readonly reason = signal<Reason>('manual');
  protected readonly typed = signal('');
  protected readonly problem = signal<string | null>(null);

  /** What was typed, when it is a usable amount. */
  private readonly amount = computed<Paise | null>(() => {
    const raw = this.typed().trim();
    if (raw === '') return null;
    try {
      const value = parseAmount(raw);
      return value > 0 ? value : null;
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      return null;
    }
  });

  /** Taking out more than the pot holds is allowed, but worth a visible note. */
  protected readonly overdraws = computed(() => {
    const amount = this.amount();
    return this.direction() === 'out' && amount !== null && amount > this.pot().balancePaise;
  });

  protected readonly id = computed(() => `mv-${this.pot().id}`);

  protected onTyped(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.typed.set(event.target.value);
  }

  protected onDirection(value: Direction): void {
    this.direction.set(value);
  }

  protected onReason(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    const picked = REASONS.find((r) => r.id === value);
    if (picked !== undefined) this.reason.set(picked.id);
  }

  protected submit(): void {
    const amount = this.amount();
    if (amount === null) {
      this.problem.set('Enter an amount above zero, like 2,500 or 2,500.50.');
      return;
    }
    this.problem.set(null);
    this.move.emit({
      amountPaise: this.direction() === 'in' ? amount : negatePaise(amount),
      reason: this.reason(),
    });
  }
}
