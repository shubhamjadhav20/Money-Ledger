/**
 * Transaction dates are calendar dates with no time and no timezone ("YYYY-MM-DD").
 * A statement says "05/11/2026"; storing that as UTC midnight would show 04/11 in IST.
 * Date.UTC is used only as a day counter, never to read the clock.
 */

declare const localDateBrand: unique symbol;
export type LocalDate = string & { readonly [localDateBrand]: 'LocalDate' };

export type DateFormat =
  | 'yyyy-mm-dd'
  | 'dd/mm/yyyy'
  | 'dd/mm/yy'
  | 'dd-mm-yyyy'
  | 'dd-mm-yy'
  | 'dd-mmm-yyyy'
  | 'dd-mmm-yy'
  | 'dd mmm yyyy';

export class DateError extends Error {
  override name = 'DateError';
}

const MS_PER_DAY = 86_400_000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export function localDate(year: number, month: number, day: number): LocalDate {
  const valid =
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= 1900 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month);
  if (!valid) {
    throw new DateError(`Not a calendar date: ${String(year)}-${String(month)}-${String(day)}`);
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as LocalDate;
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const FORMATS: Record<DateFormat, { pattern: RegExp; monthName: boolean; twoDigitYear: boolean }> =
  {
    'yyyy-mm-dd': {
      pattern: /^(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})$/,
      monthName: false,
      twoDigitYear: false,
    },
    'dd/mm/yyyy': {
      pattern: /^(?<d>\d{1,2})\/(?<m>\d{1,2})\/(?<y>\d{4})$/,
      monthName: false,
      twoDigitYear: false,
    },
    'dd/mm/yy': {
      pattern: /^(?<d>\d{1,2})\/(?<m>\d{1,2})\/(?<y>\d{2})$/,
      monthName: false,
      twoDigitYear: true,
    },
    'dd-mm-yyyy': {
      pattern: /^(?<d>\d{1,2})-(?<m>\d{1,2})-(?<y>\d{4})$/,
      monthName: false,
      twoDigitYear: false,
    },
    'dd-mm-yy': {
      pattern: /^(?<d>\d{1,2})-(?<m>\d{1,2})-(?<y>\d{2})$/,
      monthName: false,
      twoDigitYear: true,
    },
    'dd-mmm-yyyy': {
      pattern: /^(?<d>\d{1,2})-(?<m>[a-z]{3})-(?<y>\d{4})$/i,
      monthName: true,
      twoDigitYear: false,
    },
    'dd-mmm-yy': {
      pattern: /^(?<d>\d{1,2})-(?<m>[a-z]{3})-(?<y>\d{2})$/i,
      monthName: true,
      twoDigitYear: true,
    },
    'dd mmm yyyy': {
      pattern: /^(?<d>\d{1,2}) (?<m>[a-z]{3}) (?<y>\d{4})$/i,
      monthName: true,
      twoDigitYear: false,
    },
  };

/** Parse a statement date in a known format. Two-digit years are 20yy. Invalid dates throw. */
export function parseLocalDate(input: string, format: DateFormat): LocalDate {
  const spec = FORMATS[format];
  const groups = spec.pattern.exec(input.trim())?.groups;
  const [y, m, d] = [groups?.['y'], groups?.['m'], groups?.['d']];
  if (y === undefined || m === undefined || d === undefined) {
    throw new DateError(`Date ${JSON.stringify(input)} does not match format ${format}`);
  }
  const month = spec.monthName ? MONTHS.indexOf(m.toLowerCase()) + 1 : Number(m);
  if (month === 0) throw new DateError(`Unknown month in ${JSON.stringify(input)}`);
  const year = spec.twoDigitYear ? 2000 + Number(y) : Number(y);
  return localDate(year, month, Number(d));
}

function toDayNumber(date: LocalDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

function fromDayNumber(dayNumber: number): LocalDate {
  const dt = new Date(dayNumber * MS_PER_DAY);
  return localDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export const addDays = (date: LocalDate, days: number): LocalDate =>
  fromDayNumber(toDayNumber(date) + days);

/** Signed number of calendar days from `a` to `b`. */
export const daysBetween = (a: LocalDate, b: LocalDate): number => toDayNumber(b) - toDayNumber(a);
