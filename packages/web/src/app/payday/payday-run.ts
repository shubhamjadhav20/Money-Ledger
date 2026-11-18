import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { MoneyError, paise, parseAmount } from '@ledger/core';
import type { Paise } from '@ledger/core';
import type { AllocationView, PaydayOutcomeView, PotView } from '../api/models';
import { plural } from '../format';
import { UiButton } from '../ui/button';
import { UiMoney } from '../ui/money';
import type { Preview } from './payday-store';

/**
 * Try a payday: type a salary, see how the saved split divides it, then (only if you confirm) put
 * the pot shares into the pots. Looking changes nothing; adding is recorded once, however many
 * times the button is pressed, because the whole run carries one id.
 */
@Component({
  selector: 'app-payday-run',
  imports: [UiButton, UiMoney],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payday-run.html',
  styleUrls: ['./fields.css', './payday-run.css'],
})
export class PaydayRun {
  readonly hasRules = input(false);
  readonly preview = input<Preview | null>(null);
  readonly applied = input<PaydayOutcomeView | null>(null);
  readonly pots = input<readonly PotView[]>([]);
  readonly saving = input(false);
  readonly failure = input<string | null>(null);

  readonly calculate = output<Paise>();
  readonly apply = output();
  readonly discard = output();
  readonly dismiss = output();

  protected readonly amount = signal('');
  protected readonly problem = signal<string | null>(null);
  /** Asking "are you sure?" is only meaningful for the preview it was asked about. */
  protected readonly confirming = linkedSignal<Preview | null, boolean>({
    source: this.preview,
    computation: () => false,
  });

  /** The shares that go into a pot (a line with no pot stays with you). */
  protected readonly toPots = computed<readonly AllocationView[]>(() =>
    (this.preview()?.split.allocations ?? []).filter(
      (a) => a.potId !== null && a.allocatedPaise > 0,
    ),
  );
  protected readonly toPotsTotal = computed(() =>
    paise(this.toPots().reduce((sum, a) => sum + a.allocatedPaise, 0)),
  );
  protected readonly appliedToPots = computed<readonly AllocationView[]>(() =>
    (this.applied()?.result.allocations ?? []).filter(
      (a) => a.potId !== null && a.allocatedPaise > 0,
    ),
  );

  protected readonly plural = plural;

  protected potName(id: string | null): string {
    if (id === null) return 'Stays with you';
    return this.pots().find((pot) => pot.id === id)?.name ?? 'A pot';
  }

  protected onAmount(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.amount.set(event.target.value);
  }

  protected submit(): void {
    try {
      const parsed = parseAmount(this.amount());
      if (parsed <= 0) {
        this.problem.set('Enter more than zero.');
        return;
      }
      this.problem.set(null);
      this.calculate.emit(parsed);
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      this.problem.set('Use a plain amount like 85,000.');
    }
  }
}
