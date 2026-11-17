import { addDays } from '@ledger/core';
import type { LocalDate } from '@ledger/core';

const dayFormatter = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC', // LocalDate has no time zone: format it as the calendar date it is
});

/** "Mon, 7 Dec". */
export function formatDay(date: LocalDate): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return dayFormatter.format(new Date(Date.UTC(y, m - 1, d)));
}

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/** The server's idea of today, recovered from its own payday answer (no client clock involved). */
export const todayFromPayday = (nextPayday: LocalDate, daysToPayday: number): LocalDate =>
  addDays(nextPayday, -daysToPayday);
