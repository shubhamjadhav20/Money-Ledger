/**
 * API fixtures and a fake `ApiClient` for specs only (excluded from the app build). The JSON is
 * what the server sends; the "views" are the same data after decoding. Today is 2026-11-17 and
 * payday is 7 December, so free-to-spend covers 20 days.
 */
import type { ApiClient, FreeResult } from './app/api/api-client';
import {
  decodeBalances,
  decodeForecast,
  decodeFree,
  decodePots,
  decodeScheduled,
} from './app/api/models';

export const BALANCES_JSON = {
  items: [
    {
      accountId: 'acc-bank',
      name: 'HDFC Bank',
      kind: 'bank',
      balancePaise: 4_500_000,
      asOf: '2026-11-17',
      cycle: null,
    },
    {
      accountId: 'acc-card',
      name: 'ICICI card',
      kind: 'card',
      balancePaise: -1_200_000,
      asOf: '2026-11-17',
      cycle: { statementDay: 20, dueDay: 8 },
    },
    {
      accountId: 'acc-cash',
      name: 'Cash',
      kind: 'cash',
      balancePaise: 500_000,
      asOf: '2026-11-17',
      cycle: null,
    },
  ],
};

export const FREE_JSON = {
  freePaise: 3_250_000,
  nextPayday: '2026-12-07',
  daysToPayday: 20,
  lines: [
    { label: 'Bank and cash', amountPaise: 5_000_000 },
    { label: 'Card dues', amountPaise: -1_200_000 },
    { label: 'Bills before payday', amountPaise: -350_000 },
    { label: 'Buffer', amountPaise: -200_000 },
  ],
  balances: BALANCES_JSON.items,
  warnings: ['ICICI card balance is 9 days old.'],
};

export const FORECAST_JSON = {
  burnPaisePerDay: 120_000,
  daysToPayday: 20,
  projectedFreePaise: 850_000,
  runwayDays: 27,
  windowDays: 14,
};

export const POTS_JSON = {
  items: [
    {
      id: 'pot-buffer',
      name: 'Emergency buffer',
      kind: 'buffer',
      balancePaise: 200_000,
      targetPaise: 1_000_000,
      dueDate: null,
    },
    {
      id: 'pot-rent',
      name: 'Rent',
      kind: 'bill',
      balancePaise: 1_500_000,
      targetPaise: null,
      dueDate: '2026-12-01',
    },
  ],
};

export const SCHEDULED_JSON = {
  items: [
    { id: 's-rent', name: 'Rent', amountPaise: 2_500_000, date: null, monthlyDay: 1 },
    { id: 's-tv', name: 'Streaming', amountPaise: 64_900, date: null, monthlyDay: 25 },
    {
      id: 's-ins',
      name: 'Insurance premium',
      amountPaise: 1_100_000,
      date: '2026-11-28',
      monthlyDay: null,
    },
  ],
};

export const MISSING_JSON = [{ accountId: 'acc-card', name: 'ICICI card' }];

export const FREE = decodeFree(FREE_JSON);
export const FORECAST = decodeForecast(FORECAST_JSON);
export const POTS = decodePots(POTS_JSON);
export const SCHEDULED = decodeScheduled(SCHEDULED_JSON);
export const BALANCES = decodeBalances(BALANCES_JSON);

export type Api = Pick<
  ApiClient,
  'checkToken' | 'free' | 'forecast' | 'pots' | 'scheduled' | 'balances' | 'recordBalance'
>;

/** An `ApiClient` stand-in that answers with the fixtures above unless told otherwise. */
export function fakeApi(over: Partial<Api> = {}) {
  const ready: FreeResult = { kind: 'ready', free: FREE };
  return {
    checkToken: vi.fn(over.checkToken ?? (() => Promise.resolve())),
    free: vi.fn(over.free ?? (() => Promise.resolve(ready))),
    forecast: vi.fn(over.forecast ?? (() => Promise.resolve(FORECAST))),
    pots: vi.fn(over.pots ?? (() => Promise.resolve(POTS))),
    scheduled: vi.fn(over.scheduled ?? (() => Promise.resolve(SCHEDULED))),
    balances: vi.fn(over.balances ?? (() => Promise.resolve(BALANCES))),
    recordBalance: vi.fn(over.recordBalance ?? (() => Promise.resolve())),
  };
}
