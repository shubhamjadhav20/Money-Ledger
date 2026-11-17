/**
 * API fixtures and a fake `ApiClient` for specs only (excluded from the app build). The JSON is
 * what the server sends; the "views" are the same data after decoding. Today is 2026-11-17 and
 * payday is 7 December, so free-to-spend covers 20 days.
 */
import type { ApiClient, FreeResult, ImportRequest } from './app/api/api-client';
import type { ImportPlanView } from './app/api/models';
import { must } from './testing';
import {
  decodeBalances,
  decodeForecast,
  decodeFree,
  decodeImportOutcome,
  decodeImportPlan,
  decodePots,
  decodeScheduled,
  decodeSummary,
  decodeTransactions,
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

export const TRANSACTIONS_JSON = {
  items: [
    {
      id: 't-chai',
      accountId: 'acc-cash',
      date: '2026-11-17',
      amountPaise: -25_000,
      counterparty: '',
      memo: 'chai',
      category: 'Food',
      kind: 'spend',
      method: 'cash',
      status: 'pending',
      source: 'manual',
    },
    {
      id: 't-swiggy',
      accountId: 'acc-bank',
      date: '2026-11-16',
      amountPaise: -45_000,
      counterparty: 'Swiggy',
      memo: 'dinner',
      category: 'Food',
      kind: 'spend',
      method: 'upi',
      status: 'posted',
      source: 'import',
    },
    {
      id: 't-mart',
      accountId: 'acc-card',
      date: '2026-11-15',
      amountPaise: -120_000,
      counterparty: 'Metro Mart',
      memo: '',
      category: null,
      kind: 'spend',
      method: 'card',
      status: 'posted',
      source: 'import',
    },
    {
      id: 't-salary',
      accountId: 'acc-bank',
      date: '2026-11-14',
      amountPaise: 8_500_000,
      counterparty: 'Employer Pvt Ltd',
      memo: 'Salary',
      category: 'Salary',
      kind: 'income',
      method: 'netbanking',
      status: 'posted',
      source: 'import',
    },
    {
      id: 't-cardpay',
      accountId: 'acc-bank',
      date: '2026-11-14',
      amountPaise: -500_000,
      counterparty: 'ICICI card payment',
      memo: '',
      category: null,
      kind: 'transfer',
      method: 'netbanking',
      status: 'posted',
      source: 'import',
    },
  ],
};

const noKind = { netPaise: 0, count: 0 };

export const SUMMARY_JSON = {
  month: '2026-11',
  byKind: {
    spend: { netPaise: -190_000, count: 3 },
    income: { netPaise: 8_500_000, count: 1 },
    transfer: { netPaise: -500_000, count: 1 },
    investment: noKind,
    family: noKind,
  },
  incomePaise: 8_500_000,
  investedPaise: 0,
  familyPaise: 0,
  spendPaise: 190_000,
  fixedSpendPaise: 0,
  variableSpendPaise: 190_000,
  leftoverPaise: 8_310_000,
  spendByCategory: [
    { category: 'Uncategorised', spentPaise: 120_000, fixed: false },
    { category: 'Food', spentPaise: 70_000, fixed: false },
  ],
};

/** Entries added by hand that are still waiting for their statement row. */
export const PENDING_JSON = {
  items: [
    {
      id: 'p-bakery-a',
      accountId: 'acc-bank',
      date: '2026-10-06',
      amountPaise: -17_539,
      counterparty: '',
      memo: 'bakery',
      category: 'food',
      kind: 'spend',
      method: 'upi',
      status: 'pending',
      source: 'manual',
    },
    {
      id: 'p-bakery-b',
      accountId: 'acc-bank',
      date: '2026-10-07',
      amountPaise: -17_539,
      counterparty: '',
      memo: 'bread and cake',
      category: 'food',
      kind: 'spend',
      method: 'upi',
      status: 'pending',
      source: 'manual',
    },
    {
      id: 't-chai',
      accountId: 'acc-bank',
      date: '2026-10-03',
      amountPaise: -2_000,
      counterparty: '',
      memo: 'chai',
      category: 'food',
      kind: 'spend',
      method: 'upi',
      status: 'pending',
      source: 'manual',
    },
  ],
};

export const IMPORT_PLAN_JSON = {
  duplicateCount: 3,
  toInsert: [
    {
      rowKey: 'k-rent#1',
      line: 6,
      date: '2026-10-02',
      amountPaise: -1_800_000,
      counterparty: 'NEFT RENT TO LANDLORD (DEMO)',
    },
    {
      rowKey: 'k-cinema#1',
      line: 7,
      date: '2026-10-02',
      amountPaise: -120_406,
      counterparty: 'UPI/CINEMA HALL',
    },
  ],
  merges: [
    {
      rowKey: 'k-chai#1',
      line: 8,
      date: '2026-10-03',
      amountPaise: -2_000,
      counterparty: 'UPI/CHAI POINT',
      pendingId: 't-chai',
    },
  ],
  ambiguous: [
    {
      rowKey: 'k-bakery#1',
      line: 9,
      date: '2026-10-07',
      amountPaise: -17_539,
      counterparty: 'UPI/BAKERY THREE',
      pendingIds: ['p-bakery-a', 'p-bakery-b'],
    },
  ],
  issues: [],
};

export const IMPORT_OUTCOME_JSON = {
  batchId: 'batch-1',
  inserted: 2,
  merged: 1,
  duplicates: 3,
  held: 1,
};

export const FREE = decodeFree(FREE_JSON);
export const FORECAST = decodeForecast(FORECAST_JSON);
export const POTS = decodePots(POTS_JSON);
export const SCHEDULED = decodeScheduled(SCHEDULED_JSON);
export const BALANCES = decodeBalances(BALANCES_JSON);
export const TRANSACTIONS = decodeTransactions(TRANSACTIONS_JSON);
export const SUMMARY = decodeSummary(SUMMARY_JSON);
export const PENDING = decodeTransactions(PENDING_JSON);
export const IMPORT_PLAN = decodeImportPlan(IMPORT_PLAN_JSON);
export const IMPORT_OUTCOME = decodeImportOutcome(IMPORT_OUTCOME_JSON);

export type Api = Pick<
  ApiClient,
  | 'checkToken'
  | 'free'
  | 'forecast'
  | 'pots'
  | 'scheduled'
  | 'balances'
  | 'recordBalance'
  | 'transactions'
  | 'summary'
  | 'updateTransaction'
  | 'previewImport'
  | 'confirmImport'
>;

/** An `ApiClient` stand-in that answers with the fixtures above unless told otherwise. */
/**
 * A server stand-in for the import preview: the ambiguous bakery row becomes a merge when one of its
 * candidates is chosen, a new transaction on "new", and stays ambiguous for anything else.
 */
export function planFor(request: ImportRequest): ImportPlanView {
  const choice = request.choices?.['k-bakery#1'];
  const { pendingIds, ...row } = must(IMPORT_PLAN.ambiguous[0]);
  if (choice === 'new') {
    return { ...IMPORT_PLAN, ambiguous: [], toInsert: [...IMPORT_PLAN.toInsert, row] };
  }
  if (choice !== undefined && pendingIds.includes(choice)) {
    return {
      ...IMPORT_PLAN,
      ambiguous: [],
      merges: [...IMPORT_PLAN.merges, { ...row, pendingId: choice }],
    };
  }
  return IMPORT_PLAN;
}

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
    transactions: vi.fn(over.transactions ?? (() => Promise.resolve(TRANSACTIONS))),
    summary: vi.fn(over.summary ?? (() => Promise.resolve(SUMMARY))),
    previewImport: vi.fn(over.previewImport ?? (() => Promise.resolve(IMPORT_PLAN))),
    confirmImport: vi.fn(over.confirmImport ?? (() => Promise.resolve(IMPORT_OUTCOME))),
    updateTransaction: vi.fn(
      over.updateTransaction ??
        ((id, change) => {
          const row = TRANSACTIONS.find((t) => t.id === id);
          if (row === undefined) return Promise.reject(new Error('no such fixture'));
          return Promise.resolve({ ...row, ...change });
        }),
    ),
  };
}
