import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { Paise, PaydayRule } from '@ledger/core';
import type { ScheduledInput, SettingsChange } from '../api/api-client';
import type { ScheduledView } from '../api/models';
import { formatDay } from '../format';
import { UiButton } from '../ui/button';
import { UiCard } from '../ui/card';
import { UiMoney } from '../ui/money';
import { UiStateMessage } from '../ui/state-message';
import { ordinal } from './labels';
import { PaydayRun } from './payday-run';
import { PaydayStore } from './payday-store';
import { RulesEditor } from './rules-editor';
import { ScheduledForm } from './scheduled-form';
import { SettingsForm } from './settings-form';

/** Payday: when you are paid, where the salary goes, and the outflows you know are coming. */
@Component({
  selector: 'app-payday',
  imports: [
    PaydayRun,
    RulesEditor,
    ScheduledForm,
    SettingsForm,
    UiButton,
    UiCard,
    UiMoney,
    UiStateMessage,
  ],
  providers: [PaydayStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payday.html',
  styleUrl: './payday.css',
})
export class Payday {
  protected readonly store = inject(PaydayStore);

  protected readonly adding = signal(false);
  /** The scheduled item whose removal is waiting for a second click. */
  protected readonly removing = signal<string | null>(null);

  constructor() {
    void this.store.load();
  }

  protected reload(): void {
    void this.store.load();
  }

  protected when(item: ScheduledView): string {
    if (item.monthlyDay !== null) return `Every month on the ${ordinal(item.monthlyDay)}`;
    return item.date === null ? '' : formatDay(item.date);
  }

  protected saveSettings(change: SettingsChange): void {
    void this.store.saveSettings(change);
  }

  protected saveRules(rules: readonly PaydayRule[]): void {
    void this.store.saveRules(rules);
  }

  protected calculate(amount: Paise): void {
    void this.store.previewSalary(amount);
  }

  protected toggleAdd(): void {
    this.store.clearFailure();
    this.removing.set(null);
    this.adding.update((open) => !open);
  }

  protected async add(input: ScheduledInput): Promise<void> {
    if (await this.store.addScheduled(input)) this.adding.set(false);
  }

  protected askRemove(id: string): void {
    this.store.clearFailure();
    this.adding.set(false);
    this.removing.set(id);
  }

  protected async remove(id: string): Promise<void> {
    if (await this.store.removeScheduled(id)) this.removing.set(null);
  }
}
