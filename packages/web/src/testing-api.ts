/**
 * API fixtures and a fake `ApiClient` for specs only (excluded from the app build). The JSON is
 * what the server sends; the "views" are the same data after decoding. Today is 2026-11-17 and
 * payday is 7 December, so free-to-spend covers 20 days.
 */
import type { ApiClient, FreeResult, ImportRequest } from './app/api/api-client';
import { parseLocalDate, paise } from '@ledger/core';
import type {
  CapturedView,
  ImportPlanView,
  PaydayOutcomeView,
  PaydaySplitView,
  PaydayRuleView,
  ScheduledView,
  SettingsView,
} from './app/api/models';
import { must } from './testing';
import {
  decodeBalances,
  decodeForecast,
  decodeFree,
  decodeImportOutcome,
  decodeImportPlan,
  decodePaydayOutcome,
  decodePaydayRules,
  decodePaydaySplit,
  decodePot,
  decodePotMovements,
  decodePots,
  decodeReconcile,
  decodeScheduled,
  decodeSettings,
  decodeSummary,
  decodeTransactions,
} from './app/api/models';

/** What `POST /capture` answers for "450 dinner upi". */
export const CAPTURE_JSON = {
  id: 'cap-1',
  entry: {
    date: '2026-11-17',
    amountPaise: -45_000,
    method: 'upi',
    category: 'dinner',
    kind: 'spend',
    memo: '',
    status: 'pending',
  },
};

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

/** A bill pot that covers a card, kept apart so the Dashboard fixtures stay as they are. */
export const CARD_POT_JSON = {
  id: 'pot-card',
  name: 'ICICI card bill',
  kind: 'bill',
  balancePaise: 90_000,
  targetPaise: null,
  dueDate: '2026-12-08',
  coversCardAccountId: 'acc-card',
};

/** The journal of the Emergency buffer pot, oldest first as the API sends it. */
export const MOVEMENTS_JSON = {
  items: [
    {
      id: 'm-1',
      potId: 'pot-buffer',
      amountPaise: 300_000,
      reason: 'payday',
      date: '2026-11-07',
      paydayRunId: 'run-1',
    },
    { id: 'm-2', potId: 'pot-buffer', amountPaise: -100_000, reason: 'spend', date: '2026-11-12' },
  ],
};

/**
 * November's reconcile answer: a settled flight + refund, a dinner + a friend's share whose names
 * differ, four interchangeable ticket payments, and one purchase two refunds could belong to.
 */
export const RECONCILE_JSON = {
  from: '2026-11-01',
  to: '2026-11-30',
  bundles: [
    {
      id: 'bundle:t-flight+t-refund',
      txIds: ['t-flight', 't-refund'],
      netPaise: 0,
      status: 'settled',
      reason: 'matched pair; same counterparty',
      score: 0.9,
    },
    {
      id: 'bundle:t-dinner+t-friend',
      txIds: ['t-dinner', 't-friend'],
      netPaise: -15_000,
      status: 'open',
      reason: 'matched pair; counterparties differ, confirm',
      score: 0.6,
    },
    {
      id: 'bundle:t-g1+t-g2+t-g3+t-g4',
      txIds: ['t-g1', 't-g2', 't-g3', 't-g4'],
      netPaise: 800,
      status: 'open',
      reason: 'interchangeable group; counterparties differ, confirm',
      score: 0.5,
    },
  ],
  unmatched: [
    { txId: 't-a', reason: 'ambiguous', relatedTxIds: ['t-b', 't-c'] },
    { txId: 't-b', reason: 'ambiguous', relatedTxIds: ['t-a'] },
    { txId: 't-c', reason: 'ambiguous', relatedTxIds: ['t-a'] },
  ],
  singleCount: 14,
  transactions: {
    't-flight': {
      id: 't-flight',
      accountId: 'acc-card',
      date: '2026-11-03',
      amountPaise: -600_000,
      counterparty: 'AIRLINE ONE',
    },
    't-refund': {
      id: 't-refund',
      accountId: 'acc-card',
      date: '2026-11-05',
      amountPaise: 600_000,
      counterparty: 'AIRLINE ONE REFUND',
    },
    't-dinner': {
      id: 't-dinner',
      accountId: 'acc-bank',
      date: '2026-11-09',
      amountPaise: -135_000,
      counterparty: 'RESTAURANT TWO',
    },
    't-friend': {
      id: 't-friend',
      accountId: 'acc-bank',
      date: '2026-11-10',
      amountPaise: 120_000,
      counterparty: 'FRIEND ALPHA',
    },
    't-g1': {
      id: 't-g1',
      accountId: 'acc-bank',
      date: '2026-11-14',
      amountPaise: -724_600,
      counterparty: 'EVENT TICKETS CO',
    },
    't-g2': {
      id: 't-g2',
      accountId: 'acc-bank',
      date: '2026-11-14',
      amountPaise: -724_600,
      counterparty: 'EVENT TICKETS CO',
    },
    't-g3': {
      id: 't-g3',
      accountId: 'acc-bank',
      date: '2026-11-14',
      amountPaise: 725_000,
      counterparty: 'FRIEND ALPHA',
    },
    't-g4': {
      id: 't-g4',
      accountId: 'acc-bank',
      date: '2026-11-14',
      amountPaise: 725_000,
      counterparty: 'FRIEND BETA',
    },
    't-a': {
      id: 't-a',
      accountId: 'acc-bank',
      date: '2026-11-12',
      amountPaise: -200_000,
      counterparty: 'SHOP',
    },
    't-b': {
      id: 't-b',
      accountId: 'acc-bank',
      date: '2026-11-13',
      amountPaise: 200_000,
      counterparty: 'MYSTERY',
    },
    't-c': {
      id: 't-c',
      accountId: 'acc-bank',
      date: '2026-11-13',
      amountPaise: 200_000,
      counterparty: 'OTHER',
    },
  },
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

export const SETTINGS_JSON = {
  paydayDay: 7,
  paydayWeekend: 'previous-weekday',
  cardExposure: 'all_outstanding',
};

/** A split that uses every kind of rule: a fixed bill, a share of the salary, and "the rest". */
export const PAYDAY_RULES_JSON = {
  items: [
    {
      id: 'r-1',
      rule: { name: 'Emergency buffer', kind: 'fixed', amountPaise: 500_000, potId: 'pot-buffer' },
    },
    { id: 'r-2', rule: { name: 'Investing', kind: 'percent', basisPoints: 2_000 } },
    { id: 'r-3', rule: { name: 'Spending', kind: 'remainder' } },
  ],
};

/** What 80,000 rupees looks like through those rules (the buffer gets 5,000, investing 16,000). */
export const PAYDAY_SPLIT_JSON = {
  allocations: [
    {
      name: 'Emergency buffer',
      potId: 'pot-buffer',
      kind: 'fixed',
      requestedPaise: 500_000,
      allocatedPaise: 500_000,
      shortfallPaise: 0,
    },
    {
      name: 'Investing',
      kind: 'percent',
      requestedPaise: 1_600_000,
      allocatedPaise: 1_600_000,
      shortfallPaise: 0,
    },
    {
      name: 'Spending',
      kind: 'remainder',
      requestedPaise: 5_900_000,
      allocatedPaise: 5_900_000,
      shortfallPaise: 0,
    },
  ],
  unallocatedPaise: 0,
};

export const PAYDAY_OUTCOME_JSON = {
  runId: 'run-1',
  replayed: false,
  result: PAYDAY_SPLIT_JSON,
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
export const decodePotFixture = decodePot;
export const SCHEDULED: ScheduledView[] = decodeScheduled(SCHEDULED_JSON);
export const SETTINGS: SettingsView = decodeSettings(SETTINGS_JSON);
export const PAYDAY_RULES: PaydayRuleView[] = decodePaydayRules(PAYDAY_RULES_JSON);
export const PAYDAY_SPLIT: PaydaySplitView = decodePaydaySplit(PAYDAY_SPLIT_JSON);
export const PAYDAY_OUTCOME: PaydayOutcomeView = decodePaydayOutcome(PAYDAY_OUTCOME_JSON);
export const MOVEMENTS = decodePotMovements(MOVEMENTS_JSON);
export const RECONCILE = decodeReconcile(RECONCILE_JSON);
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
  | 'createPot'
  | 'updatePot'
  | 'potMovements'
  | 'reconcile'
  | 'addPotMovement'
  | 'scheduled'
  | 'addScheduled'
  | 'deleteScheduled'
  | 'settings'
  | 'updateSettings'
  | 'paydayRules'
  | 'setPaydayRules'
  | 'previewPayday'
  | 'applyPayday'
  | 'balances'
  | 'recordBalance'
  | 'transactions'
  | 'summary'
  | 'updateTransaction'
  | 'capture'
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
    createPot: vi.fn(over.createPot ?? (() => Promise.resolve('pot-new'))),
    updatePot: vi.fn(
      over.updatePot ??
        ((id, change) => {
          const pot = POTS.find((p) => p.id === id);
          if (pot === undefined) return Promise.reject(new Error('no such fixture'));
          return Promise.resolve({ ...pot, ...change });
        }),
    ),
    potMovements: vi.fn(over.potMovements ?? (() => Promise.resolve(MOVEMENTS))),
    addPotMovement: vi.fn(over.addPotMovement ?? (() => Promise.resolve())),
    reconcile: vi.fn(over.reconcile ?? (() => Promise.resolve(RECONCILE))),
    scheduled: vi.fn(over.scheduled ?? (() => Promise.resolve(SCHEDULED))),
    addScheduled: vi.fn(over.addScheduled ?? (() => Promise.resolve('s-new'))),
    deleteScheduled: vi.fn(over.deleteScheduled ?? (() => Promise.resolve())),
    settings: vi.fn(over.settings ?? (() => Promise.resolve(SETTINGS))),
    updateSettings: vi.fn(
      over.updateSettings ?? ((change) => Promise.resolve({ ...SETTINGS, ...change })),
    ),
    paydayRules: vi.fn(over.paydayRules ?? (() => Promise.resolve(PAYDAY_RULES))),
    setPaydayRules: vi.fn(over.setPaydayRules ?? (() => Promise.resolve(PAYDAY_RULES))),
    previewPayday: vi.fn(over.previewPayday ?? (() => Promise.resolve(PAYDAY_SPLIT))),
    applyPayday: vi.fn(
      over.applyPayday ?? ((input) => Promise.resolve({ ...PAYDAY_OUTCOME, runId: input.runId })),
    ),
    balances: vi.fn(over.balances ?? (() => Promise.resolve(BALANCES))),
    recordBalance: vi.fn(over.recordBalance ?? (() => Promise.resolve())),
    transactions: vi.fn(over.transactions ?? (() => Promise.resolve(TRANSACTIONS))),
    summary: vi.fn(over.summary ?? (() => Promise.resolve(SUMMARY))),
    previewImport: vi.fn(over.previewImport ?? (() => Promise.resolve(IMPORT_PLAN))),
    confirmImport: vi.fn(over.confirmImport ?? (() => Promise.resolve(IMPORT_OUTCOME))),
    capture: vi.fn(
      over.capture ??
        ((text) =>
          Promise.resolve({
            id: 'cap-1',
            date: parseLocalDate('2026-11-17', 'yyyy-mm-dd'),
            amountPaise: paise(-45_000),
            method: 'upi',
            category: 'dinner',
            kind: 'spend',
            memo: text,
            status: 'pending',
          } satisfies CapturedView)),
    ),
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
