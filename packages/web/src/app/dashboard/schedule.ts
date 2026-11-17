import { addDays, nextMonthlyDate } from '@ledger/core';
import type { LocalDate, Paise } from '@ledger/core';
import type { ScheduledView } from '../api/models';

export interface Occurrence {
  readonly id: string;
  readonly name: string;
  readonly amountPaise: Paise;
  readonly date: LocalDate;
}

/**
 * Every time a scheduled outflow falls due from `today` up to and including `until`. A one-off item
 * appears once; a monthly item appears each month it lands in the window. This is the same window
 * the server uses for free-to-spend, so what the screen lists is what was deducted.
 */
export function occurrencesUntil(
  items: readonly ScheduledView[],
  today: LocalDate,
  until: LocalDate,
): Occurrence[] {
  const found: Occurrence[] = [];
  for (const item of items) {
    const make = (date: LocalDate): Occurrence => ({
      id: item.id,
      name: item.name,
      amountPaise: item.amountPaise,
      date,
    });
    if (item.date !== null) {
      if (item.date >= today && item.date <= until) found.push(make(item.date));
    } else if (item.monthlyDay !== null) {
      let when = nextMonthlyDate(today, item.monthlyDay);
      while (when <= until) {
        found.push(make(when));
        when = nextMonthlyDate(addDays(when, 1), item.monthlyDay);
      }
    }
  }
  return found.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name),
  );
}
