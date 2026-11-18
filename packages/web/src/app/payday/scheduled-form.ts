import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { DateError, MoneyError, paise, parseAmount, parseLocalDate } from '@ledger/core';
import type { ScheduledInput } from '../api/api-client';
import { UiButton } from '../ui/button';

type Repeat = 'monthly' | 'once';
type Problems = Readonly<Partial<Record<'name' | 'amount' | 'day' | 'date', string>>>;

/** Adds a bill or other outflow that repeats on a day of the month, or happens once on a date. */
@Component({
  selector: 'app-scheduled-form',
  imports: [UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './scheduled-form.html',
  styleUrl: './fields.css',
})
export class ScheduledForm {
  readonly saving = input(false);
  readonly failure = input<string | null>(null);
  readonly add = output<ScheduledInput>();
  readonly cancel = output();

  protected readonly name = signal('');
  protected readonly amount = signal('');
  protected readonly repeat = signal<Repeat>('monthly');
  protected readonly day = signal('');
  protected readonly date = signal('');
  protected readonly problems = signal<Problems>({});

  protected onText(target: WritableSignal<string>, event: Event): void {
    if (event.target instanceof HTMLInputElement) target.set(event.target.value);
  }

  protected onRepeat(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    this.repeat.set(event.target.value === 'once' ? 'once' : 'monthly');
  }

  protected submit(): void {
    const problems: { name?: string; amount?: string; day?: string; date?: string } = {};
    const name = this.name().trim();
    if (name === '') problems.name = 'Give it a name.';
    else if (name.length > 60) problems.name = 'Keep the name to 60 characters.';

    let amount = paise(0);
    try {
      amount = parseAmount(this.amount());
      if (amount <= 0) problems.amount = 'Enter more than zero.';
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
      problems.amount = 'Use a plain amount like 2,500.';
    }

    let monthlyDay: number | undefined;
    let date: ScheduledInput['date'];
    if (this.repeat() === 'monthly') {
      const raw = this.day().trim();
      if (/^\d{1,2}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 31) monthlyDay = Number(raw);
      else problems.day = 'Pick a day from 1 to 31.';
    } else {
      try {
        date = parseLocalDate(this.date().trim(), 'yyyy-mm-dd');
      } catch (error) {
        if (!(error instanceof DateError)) throw error;
        problems.date = 'Pick a real date.';
      }
    }

    this.problems.set(problems);
    if (Object.keys(problems).length > 0) return;
    this.add.emit({
      name,
      amountPaise: amount,
      ...(monthlyDay === undefined ? {} : { monthlyDay }),
      ...(date === undefined ? {} : { date }),
    });
  }
}
