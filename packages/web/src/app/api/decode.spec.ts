import { day, DecodeError, flag, int, list, money, nullable, oneOf, record, text } from './decode';
import {
  decodeBalances,
  decodeCaptured,
  decodeForecast,
  decodeFree,
  decodeImportOutcome,
  decodeImportPlan,
  decodeMissing,
  decodeCreatedId,
  decodePot,
  decodePotMovements,
  decodePots,
  decodeReconcile,
  decodeScheduled,
  decodeSummary,
  decodeTransaction,
  decodeTransactions,
} from './models';
import {
  BALANCES_JSON,
  CAPTURE_JSON,
  FORECAST_JSON,
  CARD_POT_JSON,
  FREE_JSON,
  IMPORT_OUTCOME_JSON,
  IMPORT_PLAN_JSON,
  MISSING_JSON,
  MOVEMENTS_JSON,
  POTS_JSON,
  RECONCILE_JSON,
  SCHEDULED_JSON,
  SUMMARY_JSON,
  TRANSACTIONS_JSON,
} from '../../testing-api';

describe('decode helpers', () => {
  it('accept the right shapes', () => {
    expect(record({ a: 1 }, 'x')).toEqual({ a: 1 });
    expect(list([1], 'x')).toEqual([1]);
    expect(text('hi', 'x')).toBe('hi');
    expect(int(42, 'x')).toBe(42);
    expect(money(12_345, 'x')).toBe(12_345);
    expect(day('2026-12-07', 'x')).toBe('2026-12-07');
    expect(oneOf('bank', ['bank', 'card'] as const, 'x')).toBe('bank');
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['text', 'x'],
  ])('record rejects %s, naming the field', (_label, value) => {
    expect(() => record(value, 'balance')).toThrow(/balance should be an object/);
  });

  it('rejects floats and unsafe integers for whole numbers and money', () => {
    expect(() => int(1.5, 'n')).toThrow(DecodeError);
    expect(() => money(12.5, 'amount')).toThrow(/amount should be a whole number/);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'amount')).toThrow(DecodeError);
    expect(() => money('100', 'amount')).toThrow(DecodeError);
  });

  it('rejects dates that are not on the calendar', () => {
    expect(() => day('2026-02-30', 'when')).toThrow(/when should be a calendar date/);
    expect(() => day('07/12/2026', 'when')).toThrow(DecodeError);
    expect(() => day(20261207, 'when')).toThrow(DecodeError);
  });

  it('rejects values outside a fixed set', () => {
    expect(() => oneOf('crypto', ['bank', 'card'] as const, 'kind')).toThrow(
      /kind should be one of bank, card/,
    );
  });

  it('accepts only real booleans', () => {
    expect(flag(true, 'x')).toBe(true);
    expect(() => flag('yes', 'x')).toThrow(/x should be true or false/);
    expect(() => flag(1, 'x')).toThrow(DecodeError);
  });

  it('reads null and missing as none', () => {
    expect(nullable(null, (v) => text(v, 'x'))).toBeNull();
    expect(nullable(undefined, (v) => text(v, 'x'))).toBeNull();
    expect(nullable('a', (v) => text(v, 'x'))).toBe('a');
  });
});

describe('API model decoders', () => {
  it('decode free-to-spend, with money as integer paise and dates as calendar dates', () => {
    const free = decodeFree(FREE_JSON);
    expect(free.freePaise).toBe(3_250_000);
    expect(free.nextPayday).toBe('2026-12-07');
    expect(free.daysToPayday).toBe(20);
    expect(free.lines).toHaveLength(4);
    expect(free.balances[1]?.cycle).toEqual({ statementDay: 20, dueDay: 8 });
    expect(free.warnings).toEqual(['ICICI card balance is 9 days old.']);
  });

  it('decode balances, with missing balances and cycles as null', () => {
    const [bank, , cash] = decodeBalances(BALANCES_JSON);
    expect(bank?.cycle).toBeNull();
    expect(cash?.kind).toBe('cash');
    const [fresh] = decodeBalances({
      items: [{ accountId: 'a', name: 'New', kind: 'bank', balancePaise: null, asOf: null }],
    });
    expect(fresh?.balancePaise).toBeNull();
    expect(fresh?.asOf).toBeNull();
  });

  it('decode the forecast, with no runway when nothing is spent', () => {
    expect(decodeForecast(FORECAST_JSON).runwayDays).toBe(27);
    expect(decodeForecast({ ...FORECAST_JSON, runwayDays: null }).runwayDays).toBeNull();
  });

  it('decode pots and scheduled items', () => {
    const [buffer, rent] = decodePots(POTS_JSON);
    expect(buffer?.targetPaise).toBe(1_000_000);
    expect(rent?.targetPaise).toBeNull();
    expect(rent?.dueDate).toBe('2026-12-01');
    const [monthly, , oneOff] = decodeScheduled(SCHEDULED_JSON);
    expect(monthly?.monthlyDay).toBe(1);
    expect(monthly?.date).toBeNull();
    expect(oneOff?.date).toBe('2026-11-28');
  });

  describe('reconcile', () => {
    it('decodes bundles, review items, the ordinary-payment count and every payment', () => {
      const view = decodeReconcile(RECONCILE_JSON);
      expect(view.from).toBe('2026-11-01');
      expect(view.bundles.map((b) => [b.id, b.status, b.netPaise])).toEqual([
        ['bundle:t-flight+t-refund', 'settled', 0],
        ['bundle:t-dinner+t-friend', 'open', -15_000],
        ['bundle:t-g1+t-g2+t-g3+t-g4', 'open', 800],
      ]);
      expect(view.unmatched[0]).toEqual({
        txId: 't-a',
        reason: 'ambiguous',
        relatedTxIds: ['t-b', 't-c'],
      });
      expect(view.singleCount).toBe(14);
      expect(view.transactions.get('t-flight')?.counterparty).toBe('AIRLINE ONE');
      expect(view.transactions.size).toBe(11);
    });

    it('keeps an odd payment id from reaching the object prototype', () => {
      const tx = RECONCILE_JSON.transactions['t-flight'];
      const view = decodeReconcile({
        ...RECONCILE_JSON,
        transactions: { constructor: { ...tx, id: 'constructor' } },
      });
      expect(view.transactions.get('constructor')?.id).toBe('constructor');
      expect(view.transactions.get('toString')).toBeUndefined();
    });

    it('fails by field name on a bad shape', () => {
      const bad = (change: object) => ({ ...RECONCILE_JSON, ...change });
      expect(() => decodeReconcile(bad({ singleCount: 'many' }))).toThrow(/reconcile\.singleCount/);
      expect(() =>
        decodeReconcile(bad({ bundles: [{ ...RECONCILE_JSON.bundles[0], status: 'maybe' }] })),
      ).toThrow(/bundle\.status/);
      expect(() =>
        decodeReconcile(bad({ bundles: [{ ...RECONCILE_JSON.bundles[0], netPaise: 1.5 }] })),
      ).toThrow(/bundle\.netPaise/);
      expect(() =>
        decodeReconcile(bad({ unmatched: [{ txId: 'x', reason: 'weird', relatedTxIds: [] }] })),
      ).toThrow(/unmatched\.reason/);
      expect(() => decodeReconcile(bad({ transactions: { x: { id: 'x' } } }))).toThrow(
        /reconcile\.tx\./,
      );
      expect(() => decodeReconcile(bad({ from: 'soon' }))).toThrow(/reconcile\.from/);
    });
  });

  describe('pots', () => {
    it('decodes the card a pot covers, and null when it covers none', () => {
      expect(decodePot(CARD_POT_JSON).coversCardAccountId).toBe('acc-card');
      expect(decodePots(POTS_JSON).map((p) => p.coversCardAccountId)).toEqual([null, null]);
    });

    it('decodes a pot journal with signed amounts', () => {
      expect(decodePotMovements(MOVEMENTS_JSON)).toEqual([
        { id: 'm-1', amountPaise: 300_000, reason: 'payday', date: '2026-11-07' },
        { id: 'm-2', amountPaise: -100_000, reason: 'spend', date: '2026-11-12' },
      ]);
    });

    it('fails by field name on a bad movement or a bad created id', () => {
      const bad = (change: object) => ({ items: [{ ...MOVEMENTS_JSON.items[0], ...change }] });
      expect(() => decodePotMovements(bad({ reason: 'gift' }))).toThrow(/movement\.reason/);
      expect(() => decodePotMovements(bad({ amountPaise: 1.5 }))).toThrow(/movement\.amountPaise/);
      expect(() => decodePotMovements(bad({ date: '2026-02-30' }))).toThrow(/movement\.date/);
      expect(decodeCreatedId({ id: 'pot-9' })).toBe('pot-9');
      expect(() => decodeCreatedId({})).toThrow(/id/);
    });
  });

  it('decode the accounts that still need a balance', () => {
    expect(decodeMissing(MISSING_JSON)).toEqual([{ accountId: 'acc-card', name: 'ICICI card' }]);
  });

  it('fail by field name when the server sends the wrong shape', () => {
    expect(() => decodeFree({ ...FREE_JSON, freePaise: 32_500.5 })).toThrow(/free\.freePaise/);
    expect(() => decodeFree({ ...FREE_JSON, nextPayday: 'soon' })).toThrow(/free\.nextPayday/);
    expect(() => decodeFree({ ...FREE_JSON, lines: 'none' })).toThrow(/free\.lines/);
    expect(() => decodePots({ items: [{ ...POTS_JSON.items[0], kind: 'vault' }] })).toThrow(
      /pot\.kind/,
    );
    expect(() => decodeMissing({})).toThrow(/details should be a list/);
  });
});

describe('transaction and summary decoders', () => {
  it('decode transactions, keeping signed paise and a missing category as null', () => {
    const [chai, , mart, salary] = decodeTransactions(TRANSACTIONS_JSON);
    expect(chai?.amountPaise).toBe(-25_000);
    expect(chai?.status).toBe('pending');
    expect(chai?.counterparty).toBe('');
    expect(mart?.category).toBeNull();
    expect(salary?.amountPaise).toBe(8_500_000);
    expect(salary?.kind).toBe('income');
  });

  it('refuse a transaction with a wrong kind, method, status or amount', () => {
    const base = TRANSACTIONS_JSON.items[1];
    expect(() => decodeTransaction({ ...base, kind: 'gift' })).toThrow(/transaction\.kind/);
    expect(() => decodeTransaction({ ...base, method: 'crypto' })).toThrow(/transaction\.method/);
    expect(() => decodeTransaction({ ...base, status: 'void' })).toThrow(/transaction\.status/);
    expect(() => decodeTransaction({ ...base, amountPaise: -450.5 })).toThrow(
      /transaction\.amountPaise/,
    );
    expect(() => decodeTransaction({ ...base, date: '2026-02-30' })).toThrow(/transaction\.date/);
  });

  it('decode the monthly summary', () => {
    const summary = decodeSummary(SUMMARY_JSON);
    expect(summary.month).toBe('2026-11');
    expect(summary.spendPaise).toBe(190_000);
    expect(summary.leftoverPaise).toBe(8_310_000);
    expect(summary.transferCount).toBe(1);
    expect(summary.spendByCategory.map((c) => c.category)).toEqual(['Uncategorised', 'Food']);
  });

  it('refuse a summary with missing parts', () => {
    expect(() => decodeSummary({ ...SUMMARY_JSON, byKind: {} })).toThrow(
      /summary\.byKind\.transfer/,
    );
    expect(() => decodeSummary({ ...SUMMARY_JSON, spendPaise: 1.5 })).toThrow(
      /summary\.spendPaise/,
    );
    expect(() =>
      decodeSummary({ ...SUMMARY_JSON, spendByCategory: [{ category: 'x', spentPaise: 1 }] }),
    ).toThrow(/category\.fixed/);
  });
});

describe('import decoders', () => {
  it('decode a plan: new rows, rows that complete an entry, ambiguous rows and read problems', () => {
    const plan = decodeImportPlan(IMPORT_PLAN_JSON);
    expect(plan.duplicateCount).toBe(3);
    expect(plan.toInsert.map((r) => r.rowKey)).toEqual(['k-rent#1', 'k-cinema#1']);
    expect(plan.toInsert[0]?.amountPaise).toBe(-1_800_000);
    expect(plan.merges[0]?.pendingId).toBe('t-chai');
    expect(plan.ambiguous[0]?.pendingIds).toEqual(['p-bakery-a', 'p-bakery-b']);
    expect(plan.issues).toEqual([]);
  });

  it('decode issues, line 0 meaning the whole file', () => {
    const plan = decodeImportPlan({
      ...IMPORT_PLAN_JSON,
      issues: [
        { line: 0, reason: 'Header row not found' },
        { line: 7, reason: 'Bad date' },
      ],
    });
    expect(plan.issues).toEqual([
      { line: 0, reason: 'Header row not found' },
      { line: 7, reason: 'Bad date' },
    ]);
  });

  it('refuse a plan with a float amount, a bad date or a missing list', () => {
    const row = IMPORT_PLAN_JSON.toInsert[0];
    expect(() =>
      decodeImportPlan({ ...IMPORT_PLAN_JSON, toInsert: [{ ...row, amountPaise: 1.5 }] }),
    ).toThrow(/row\.amountPaise/);
    expect(() =>
      decodeImportPlan({ ...IMPORT_PLAN_JSON, toInsert: [{ ...row, date: '2026-02-30' }] }),
    ).toThrow(/row\.date/);
    expect(() => decodeImportPlan({ ...IMPORT_PLAN_JSON, issues: undefined })).toThrow(
      /import\.issues/,
    );
    expect(() =>
      decodeImportPlan({
        ...IMPORT_PLAN_JSON,
        ambiguous: [{ ...IMPORT_PLAN_JSON.ambiguous[0], pendingIds: [1] }],
      }),
    ).toThrow(/ambiguous\.pendingIds/);
  });

  it('decode the outcome, with no batch when nothing changed', () => {
    expect(decodeImportOutcome(IMPORT_OUTCOME_JSON).inserted).toBe(2);
    expect(decodeImportOutcome({ ...IMPORT_OUTCOME_JSON, batchId: null }).batchId).toBeNull();
    expect(() => decodeImportOutcome({ ...IMPORT_OUTCOME_JSON, merged: '1' })).toThrow(
      /outcome\.merged/,
    );
  });
});

describe('capture decoder', () => {
  it('reads the saved entry', () => {
    expect(decodeCaptured(CAPTURE_JSON)).toEqual({
      id: 'cap-1',
      date: '2026-11-17',
      amountPaise: -45_000,
      method: 'upi',
      category: 'dinner',
      kind: 'spend',
      memo: '',
      status: 'pending',
    });
  });

  it('rejects a reply that has the wrong shape, naming the field', () => {
    expect(() => decodeCaptured({ id: 'x' })).toThrow(/capture.entry should be an object/);
    expect(() =>
      decodeCaptured({ ...CAPTURE_JSON, entry: { ...CAPTURE_JSON.entry, amountPaise: 4.5 } }),
    ).toThrow(/capture.entry.amountPaise/);
    expect(() =>
      decodeCaptured({ ...CAPTURE_JSON, entry: { ...CAPTURE_JSON.entry, kind: 'transfer' } }),
    ).toThrow(/capture.entry.kind/);
  });
});
