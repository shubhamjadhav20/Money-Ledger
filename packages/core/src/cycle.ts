/**
 * Monthly calendar rules: card statement cycles and payday. PLAN.md rule 5.
 * Days 29-31 clamp to the month's last day (statement day 31 -> 28/29 Feb, 30 Apr).
 * TODO: bank-holiday shifts for due dates; verify per card issuer before relying on them.
 */
import { addDays, daysInMonth, localDate } from './dates.ts';
import type { LocalDate } from './dates.ts';
import { negatePaise, paise, sumPaise } from './money.ts';
import type { Paise } from './money.ts';

export interface CardCycle {
  /** Day of month the statement is generated (1..31, clamped to month end). */
  readonly statementDay: number;
  /** Day of month payment is due, after the statement (1..31, clamped). */
  readonly dueDay: number;
}

export interface PaydaySchedule {
  readonly day: number;
  /** Move a Saturday/Sunday payday to the previous Friday. Default: none. */
  readonly weekend?: 'none' | 'previous-weekday';
}

const parts = (date: LocalDate): [number, number, number] =>
  date.split('-').map(Number) as [number, number, number];

const clamped = (year: number, month: number, day: number): LocalDate =>
  localDate(year, month, Math.min(day, daysInMonth(year, month)));

const nextMonth = (year: number, month: number): [number, number] =>
  month === 12 ? [year + 1, 1] : [year, month + 1];

/** First date on/after (inclusive) or after `from` that falls on `day` of its month (clamped). */
export function nextMonthlyDate(from: LocalDate, day: number, inclusive = true): LocalDate {
  if (!Number.isInteger(day) || day < 1 || day > 31)
    throw new RangeError(`Day must be 1..31, got ${String(day)}`);
  const [y, m] = parts(from);
  const thisMonth = clamped(y, m, day);
  if (inclusive ? thisMonth >= from : thisMonth > from) return thisMonth;
  const [ny, nm] = nextMonth(y, m);
  return clamped(ny, nm, day);
}

/** The statement a purchase on `date` appears on (purchases on statement day are included). */
export const statementDateFor = (date: LocalDate, cycle: CardCycle): LocalDate =>
  nextMonthlyDate(date, cycle.statementDay);

/** Payment due date for a statement. */
export const dueDateFor = (statement: LocalDate, cycle: CardCycle): LocalDate =>
  nextMonthlyDate(statement, cycle.dueDay, false);

export const nextStatementDate = (today: LocalDate, cycle: CardCycle): LocalDate =>
  nextMonthlyDate(today, cycle.statementDay);

export const nextDueDate = (today: LocalDate, cycle: CardCycle): LocalDate =>
  nextMonthlyDate(today, cycle.dueDay);

/** Inclusive date range of transactions billed on `statement`. */
export function statementPeriod(
  statement: LocalDate,
  cycle: CardCycle,
): { from: LocalDate; to: LocalDate } {
  const [y, m] = parts(statement);
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  const previous = clamped(py, pm, cycle.statementDay);
  return { from: addDays(previous, 1), to: statement };
}

/** What a statement asks you to pay: net purchases in its period, never negative. */
export function amountDueFor(
  statement: LocalDate,
  cycle: CardCycle,
  cardTxs: readonly { readonly date: LocalDate; readonly amount: Paise }[],
): Paise {
  const { from, to } = statementPeriod(statement, cycle);
  const net = sumPaise(cardTxs.filter((t) => t.date >= from && t.date <= to).map((t) => t.amount));
  return net < 0 ? negatePaise(net) : paise(0);
}

function weekday(date: LocalDate): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday .. 6 Saturday
}

function shiftForWeekend(date: LocalDate, rule: PaydaySchedule): LocalDate {
  if (rule.weekend !== 'previous-weekday') return date;
  const wd = weekday(date);
  return wd === 6 ? addDays(date, -1) : wd === 0 ? addDays(date, -2) : date;
}

/** Next payday strictly after today (after any weekend shift). */
export function nextPayday(today: LocalDate, rule: PaydaySchedule): LocalDate {
  let anchor = today;
  for (;;) {
    const scheduled = nextMonthlyDate(anchor, rule.day, false);
    const actual = shiftForWeekend(scheduled, rule);
    if (actual > today) return actual;
    anchor = scheduled;
  }
}
