import type { LocalDate, Paise } from '@ledger/core';
import { day, int, list, money, nullable, oneOf, record, text } from './decode';

export interface FreeLine {
  readonly label: string;
  readonly amountPaise: Paise;
}

export interface CardCycleView {
  readonly statementDay: number;
  readonly dueDay: number;
}

export type AccountKind = 'bank' | 'card' | 'savings' | 'cash';

export interface AccountBalanceView {
  readonly accountId: string;
  readonly name: string;
  readonly kind: AccountKind;
  /** Null until a balance has been recorded for this account. */
  readonly balancePaise: Paise | null;
  readonly asOf: LocalDate | null;
  readonly cycle: CardCycleView | null;
}

export interface FreeView {
  readonly freePaise: Paise;
  readonly nextPayday: LocalDate;
  readonly daysToPayday: number;
  readonly lines: readonly FreeLine[];
  readonly balances: readonly AccountBalanceView[];
  readonly warnings: readonly string[];
}

export interface MissingAccount {
  readonly accountId: string;
  readonly name: string;
}

export interface ForecastView {
  readonly burnPaisePerDay: Paise;
  readonly daysToPayday: number;
  readonly projectedFreePaise: Paise;
  /** Whole days the free money lasts at this burn; null when nothing is being spent. */
  readonly runwayDays: number | null;
  readonly windowDays: number;
}

export type PotKind = 'buffer' | 'bill' | 'spend';

export interface PotView {
  readonly id: string;
  readonly name: string;
  readonly kind: PotKind;
  readonly balancePaise: Paise;
  readonly targetPaise: Paise | null;
  readonly dueDate: LocalDate | null;
}

export interface ScheduledView {
  readonly id: string;
  readonly name: string;
  readonly amountPaise: Paise;
  readonly date: LocalDate | null;
  readonly monthlyDay: number | null;
}

const ACCOUNT_KINDS = ['bank', 'card', 'savings', 'cash'] as const;
const POT_KINDS = ['buffer', 'bill', 'spend'] as const;

export function decodeAccountBalance(value: unknown): AccountBalanceView {
  const r = record(value, 'balance');
  return {
    accountId: text(r['accountId'], 'balance.accountId'),
    name: text(r['name'], 'balance.name'),
    kind: oneOf(r['kind'], ACCOUNT_KINDS, 'balance.kind'),
    balancePaise: nullable(r['balancePaise'], (v) => money(v, 'balance.balancePaise')),
    asOf: nullable(r['asOf'], (v) => day(v, 'balance.asOf')),
    cycle: nullable(r['cycle'], (v) => {
      const c = record(v, 'balance.cycle');
      return {
        statementDay: int(c['statementDay'], 'cycle.statementDay'),
        dueDay: int(c['dueDay'], 'cycle.dueDay'),
      };
    }),
  };
}

export const decodeBalances = (value: unknown): AccountBalanceView[] =>
  list(record(value, 'balances')['items'], 'balances.items').map(decodeAccountBalance);

export function decodeFree(value: unknown): FreeView {
  const r = record(value, 'free');
  return {
    freePaise: money(r['freePaise'], 'free.freePaise'),
    nextPayday: day(r['nextPayday'], 'free.nextPayday'),
    daysToPayday: int(r['daysToPayday'], 'free.daysToPayday'),
    lines: list(r['lines'], 'free.lines').map((line) => {
      const l = record(line, 'free.lines[]');
      return {
        label: text(l['label'], 'line.label'),
        amountPaise: money(l['amountPaise'], 'line.amountPaise'),
      };
    }),
    balances: list(r['balances'], 'free.balances').map(decodeAccountBalance),
    warnings: list(r['warnings'], 'free.warnings').map((w) => text(w, 'free.warnings[]')),
  };
}

export const decodeMissing = (details: unknown): MissingAccount[] =>
  list(details, 'details').map((item) => {
    const m = record(item, 'details[]');
    return { accountId: text(m['accountId'], 'accountId'), name: text(m['name'], 'name') };
  });

export function decodeForecast(value: unknown): ForecastView {
  const r = record(value, 'forecast');
  return {
    burnPaisePerDay: money(r['burnPaisePerDay'], 'forecast.burnPaisePerDay'),
    daysToPayday: int(r['daysToPayday'], 'forecast.daysToPayday'),
    projectedFreePaise: money(r['projectedFreePaise'], 'forecast.projectedFreePaise'),
    runwayDays: nullable(r['runwayDays'], (v) => int(v, 'forecast.runwayDays')),
    windowDays: int(r['windowDays'], 'forecast.windowDays'),
  };
}

export const decodePots = (value: unknown): PotView[] =>
  list(record(value, 'pots')['items'], 'pots.items').map((item) => {
    const p = record(item, 'pot');
    return {
      id: text(p['id'], 'pot.id'),
      name: text(p['name'], 'pot.name'),
      kind: oneOf(p['kind'], POT_KINDS, 'pot.kind'),
      balancePaise: money(p['balancePaise'], 'pot.balancePaise'),
      targetPaise: nullable(p['targetPaise'], (v) => money(v, 'pot.targetPaise')),
      dueDate: nullable(p['dueDate'], (v) => day(v, 'pot.dueDate')),
    };
  });

export const decodeScheduled = (value: unknown): ScheduledView[] =>
  list(record(value, 'scheduled')['items'], 'scheduled.items').map((item) => {
    const s = record(item, 'scheduled item');
    return {
      id: text(s['id'], 'scheduled.id'),
      name: text(s['name'], 'scheduled.name'),
      amountPaise: money(s['amountPaise'], 'scheduled.amountPaise'),
      date: nullable(s['date'], (v) => day(v, 'scheduled.date')),
      monthlyDay: nullable(s['monthlyDay'], (v) => int(v, 'scheduled.monthlyDay')),
    };
  });
