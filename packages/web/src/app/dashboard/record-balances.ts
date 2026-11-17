import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { MoneyError, negatePaise, parseAmount } from '@ledger/core';
import type { Paise } from '@ledger/core';
import type { AccountBalanceView } from '../api/models';
import type { BalanceEntry } from './dashboard-store';
import { UiButton } from '../ui/button';
import { UiMoney } from '../ui/money';

/**
 * "What does your bank app say today?" One amount per account; leave a row empty to keep its
 * balance as it is. Amounts are parsed as exact rupees and paise (no floats). For a card you
 * enter what you OWE as a positive number; it is sent as a negative balance.
 */
@Component({
  selector: 'app-record-balances',
  imports: [UiButton, UiMoney],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './record-balances.html',
  styleUrl: './record-balances.css',
})
export class RecordBalances {
  readonly accounts = input.required<readonly AccountBalanceView[]>();
  readonly saving = input(false);
  readonly failure = input<string | null>(null);
  readonly save = output<BalanceEntry[]>();

  protected readonly values = signal<Readonly<Record<string, string>>>({});
  protected readonly problems = signal<Readonly<Record<string, string>>>({});

  protected onInput(accountId: string, event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const value = event.target.value;
    this.values.update((current) => ({ ...current, [accountId]: value }));
  }

  /** A card's negative balance, as the positive amount owed. */
  protected owed(balance: Paise): Paise {
    return negatePaise(balance);
  }

  protected label(account: AccountBalanceView): string {
    return account.kind === 'card' ? `${account.name}: amount you owe (₹)` : `${account.name} (₹)`;
  }

  protected submit(): void {
    const entries: BalanceEntry[] = [];
    const problems: Record<string, string> = {};
    for (const account of this.accounts()) {
      const raw = (this.values()[account.accountId] ?? '').trim();
      if (raw === '') continue;
      try {
        const amount = parseAmount(raw);
        if (account.kind === 'card' && amount < 0) {
          problems[account.accountId] = 'Enter what you owe as a positive number.';
          continue;
        }
        entries.push({
          accountId: account.accountId,
          amountPaise: account.kind === 'card' ? negatePaise(amount) : amount,
        });
      } catch (error) {
        if (!(error instanceof MoneyError)) throw error;
        problems[account.accountId] = 'Use a plain amount like 12,345.50.';
      }
    }
    this.problems.set(problems);
    if (Object.keys(problems).length === 0 && entries.length > 0) this.save.emit(entries);
  }
}
