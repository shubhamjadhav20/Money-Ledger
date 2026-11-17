import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { PotChange, PotInput, PotMovementInput } from '../api/api-client';
import type { PotView } from '../api/models';
import { formatDay } from '../format';
import { UiBadge } from '../ui/badge';
import { UiButton } from '../ui/button';
import { UiCard } from '../ui/card';
import { UiChip } from '../ui/chip';
import { UiMoney } from '../ui/money';
import { UiStateMessage } from '../ui/state-message';
import { MOVEMENT_LABELS, POT_KIND_LABELS } from './labels';
import { PotForm } from './pot-form';
import { PotMove } from './pot-move';
import { PotsStore } from './pots-store';

type PanelMode = 'move' | 'edit' | 'history';

/** Pots: what is set aside, and every change you can make to it. */
@Component({
  selector: 'app-pots',
  imports: [PotForm, PotMove, UiBadge, UiButton, UiCard, UiChip, UiMoney, UiStateMessage],
  providers: [PotsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pots.html',
  styleUrl: './pots.css',
})
export class Pots {
  protected readonly store = inject(PotsStore);

  protected readonly formatDay = formatDay;
  protected readonly kindLabels = POT_KIND_LABELS;
  protected readonly movementLabels = MOVEMENT_LABELS;

  protected readonly creating = signal(false);
  /** The one pot panel that is open, if any. */
  protected readonly panel = signal<{ readonly id: string; readonly mode: PanelMode } | null>(null);

  constructor() {
    void this.store.load();
  }

  protected reload(): void {
    void this.store.load();
  }

  protected toggleCreate(): void {
    this.store.clearSaveError();
    this.panel.set(null);
    this.creating.update((open) => !open);
  }

  protected open(pot: PotView, mode: PanelMode): void {
    this.store.clearSaveError();
    this.creating.set(false);
    const current = this.panel();
    if (current?.id === pot.id && current.mode === mode) {
      this.panel.set(null);
      return;
    }
    this.panel.set({ id: pot.id, mode });
    if (mode === 'history') void this.store.loadHistory(pot.id);
  }

  protected isOpen(pot: PotView, mode: PanelMode): boolean {
    const current = this.panel();
    return current?.id === pot.id && current.mode === mode;
  }

  protected close(): void {
    this.store.clearSaveError();
    this.creating.set(false);
    this.panel.set(null);
  }

  protected async onCreate(input: PotInput): Promise<void> {
    if (await this.store.create(input)) this.creating.set(false);
  }

  protected async onEdit(pot: PotView, change: PotChange): Promise<void> {
    if (await this.store.update(pot.id, change)) this.panel.set(null);
  }

  protected async onMove(pot: PotView, input: PotMovementInput): Promise<void> {
    if (await this.store.move(pot.id, input)) this.panel.set(null);
  }

  /** How full a pot is, 0..100, for the meter. */
  protected percent(balance: number, target: number): number {
    return target <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((balance / target) * 100)));
  }
}
