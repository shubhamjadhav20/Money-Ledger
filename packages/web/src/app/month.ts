import { InjectionToken } from '@angular/core';
import { daysInMonth, localDate } from '@ledger/core';
import type { LocalDate } from '@ledger/core';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parts(month: string): [number, number] {
  const match = MONTH.exec(month);
  if (match === null) throw new RangeError(`Expected a month like 2026-11, got ${month}`);
  return [Number(match[1]), Number(match[2])];
}

/** First and last calendar day of a `YYYY-MM` month. */
export function monthRange(month: string): { from: LocalDate; to: LocalDate } {
  const [y, m] = parts(month);
  return { from: localDate(y, m, 1), to: localDate(y, m, daysInMonth(y, m)) };
}

/** The month `delta` months away (negative = earlier), as `YYYY-MM`. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = parts(month);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const monthFormatter = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "November 2026". */
export function formatMonth(month: string): string {
  const [y, m] = parts(month);
  return monthFormatter.format(new Date(Date.UTC(y, m - 1, 1)));
}

const kolkata = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  timeZone: 'Asia/Kolkata',
});

/** The current month in India. Only used to pick which month to open first; tests replace it. */
export const CURRENT_MONTH = new InjectionToken<string>('CURRENT_MONTH', {
  providedIn: 'root',
  factory: () => {
    const found = Object.fromEntries(
      kolkata.formatToParts(new Date()).map((p) => [p.type, p.value]),
    );
    return `${String(found['year'])}-${String(found['month'])}`;
  },
});
