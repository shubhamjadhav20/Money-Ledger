import { day, DecodeError, flag, int, list, money, nullable, oneOf, record, text } from './decode';
import {
  decodeBalances,
  decodeForecast,
  decodeFree,
  decodeMissing,
  decodePots,
  decodeScheduled,
  decodeSummary,
  decodeTransaction,
  decodeTransactions,
} from './models';
import {
  BALANCES_JSON,
  FORECAST_JSON,
  FREE_JSON,
  MISSING_JSON,
  POTS_JSON,
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
