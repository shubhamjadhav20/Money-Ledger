import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { SettingsChange } from '../api/api-client';
import { CARD_EXPOSURES, PAYDAY_WEEKENDS } from '../api/models';
import type { CardExposure, PaydayWeekend, SettingsView } from '../api/models';
import { UiButton } from '../ui/button';
import { EXPOSURE_HELP, EXPOSURE_LABELS, WEEKEND_LABELS } from './labels';

/**
 * The three settings that shape free-to-spend. Only what you changed is sent. The day is read as a
 * whole number from 1 to 31.
 */
@Component({
  selector: 'app-settings-form',
  imports: [UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-form.html',
  styleUrl: './fields.css',
})
export class SettingsForm {
  readonly settings = input.required<SettingsView>();
  readonly saving = input(false);
  readonly failure = input<string | null>(null);
  readonly save = output<SettingsChange>();

  protected readonly weekends = PAYDAY_WEEKENDS;
  protected readonly weekendLabels = WEEKEND_LABELS;
  protected readonly exposures = CARD_EXPOSURES;
  protected readonly exposureLabels = EXPOSURE_LABELS;

  private readonly typedDay = signal<string | null>(null);
  private readonly pickedWeekend = signal<PaydayWeekend | null>(null);
  private readonly pickedExposure = signal<CardExposure | null>(null);
  protected readonly problem = signal<string | null>(null);

  protected readonly day = computed(() => this.typedDay() ?? String(this.settings().paydayDay));
  protected readonly weekend = computed(
    () => this.pickedWeekend() ?? this.settings().paydayWeekend,
  );
  protected readonly exposure = computed(
    () => this.pickedExposure() ?? this.settings().cardExposure,
  );
  protected readonly exposureHelp = computed(() => EXPOSURE_HELP[this.exposure()]);

  /** What differs from the saved settings; empty when nothing was changed. */
  private readonly change = computed<SettingsChange>(() => {
    const saved = this.settings();
    const parsed = this.readDay();
    return {
      ...(parsed !== null && parsed !== saved.paydayDay ? { paydayDay: parsed } : {}),
      ...(this.weekend() !== saved.paydayWeekend ? { paydayWeekend: this.weekend() } : {}),
      ...(this.exposure() !== saved.cardExposure ? { cardExposure: this.exposure() } : {}),
    };
  });
  protected readonly changed = computed(() => Object.keys(this.change()).length > 0);

  private readDay(): number | null {
    const raw = this.day().trim();
    if (!/^\d{1,2}$/.test(raw)) return null;
    const value = Number(raw);
    return value >= 1 && value <= 31 ? value : null;
  }

  protected onDay(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.typedDay.set(event.target.value);
  }

  protected onWeekend(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    const picked = PAYDAY_WEEKENDS.find((option) => option === value);
    if (picked !== undefined) this.pickedWeekend.set(picked);
  }

  protected onExposure(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    const picked = CARD_EXPOSURES.find((option) => option === value);
    if (picked !== undefined) this.pickedExposure.set(picked);
  }

  protected submit(): void {
    if (this.readDay() === null) {
      this.problem.set('Pick a day from 1 to 31.');
      return;
    }
    this.problem.set(null);
    if (this.changed()) this.save.emit(this.change());
  }
}
