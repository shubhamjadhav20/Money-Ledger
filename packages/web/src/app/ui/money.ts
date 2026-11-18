import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatINR } from '@ledger/core';
import type { Paise } from '@ledger/core';

export type MoneySize = 'md' | 'lg' | 'display';
export type MoneyTone = 'auto' | 'neutral';

/**
 * One amount of money. Takes integer paise (never a float) and formats it with the core
 * formatter, so the web app can never disagree with the API about how a number reads.
 * `auto` colours by sign; sign is also carried by the text itself, never by colour alone.
 */
@Component({
  selector: 'ui-money',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'money', '[class]': 'classes()' },
  template: '{{ text() }}',
  styles: `
    :host {
      white-space: nowrap;
    }
    :host(.md) {
      font-size: var(--text-md);
    }
    :host(.lg) {
      font-size: var(--text-lg);
      font-weight: 600;
    }
    :host(.display) {
      font-size: var(--text-display);
      font-weight: 600;
      line-height: 1;
      letter-spacing: var(--tracking-display);
    }
    :host(.positive) {
      color: var(--color-positive);
    }
    :host(.negative) {
      color: var(--color-negative);
    }
  `,
})
export class UiMoney {
  readonly amount = input.required<Paise>();
  readonly size = input<MoneySize>('md');
  readonly tone = input<MoneyTone>('auto');
  /** Show "+" on positive amounts (for income and refunds). */
  readonly showPlus = input(false);

  protected readonly text = computed(() => {
    const amount = this.amount();
    return this.showPlus() && amount > 0 ? `+${formatINR(amount)}` : formatINR(amount);
  });

  protected readonly classes = computed(() => {
    const amount = this.amount();
    const sign =
      this.tone() === 'neutral' || amount === 0 ? '' : amount > 0 ? ' positive' : ' negative';
    return `money ${this.size()}${sign}`;
  });
}
