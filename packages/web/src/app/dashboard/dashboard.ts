import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { formatDay, plural } from '../format';
import { UiBadge } from '../ui/badge';
import { UiButton } from '../ui/button';
import { UiCard } from '../ui/card';
import { UiMoney } from '../ui/money';
import { UiStateMessage } from '../ui/state-message';
import { DashboardStore } from './dashboard-store';
import type { BalanceEntry } from './dashboard-store';
import { RecordBalances } from './record-balances';

@Component({
  selector: 'app-dashboard',
  imports: [RecordBalances, UiBadge, UiButton, UiCard, UiMoney, UiStateMessage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  protected readonly store = inject(DashboardStore);
  protected readonly editingBalances = signal(false);

  protected readonly formatDay = formatDay;
  protected readonly plural = plural;

  constructor() {
    void this.store.load();
  }

  protected reload(): void {
    void this.store.load();
  }

  protected async save(entries: BalanceEntry[]): Promise<void> {
    if (await this.store.saveBalances(entries)) this.editingBalances.set(false);
  }

  /** How full a pot is, 0..100, for the meter. Pots with no target have no meter. */
  protected percent(balance: number, target: number): number {
    return target <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((balance / target) * 100)));
  }
}
