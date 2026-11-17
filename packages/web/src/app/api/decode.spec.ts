import { day, DecodeError, int, list, money, nullable, oneOf, record, text } from './decode';
import {
  decodeBalances,
  decodeForecast,
  decodeFree,
  decodeMissing,
  decodePots,
  decodeScheduled,
} from './models';
import {
  BALANCES_JSON,
  FORECAST_JSON,
  FREE_JSON,
  MISSING_JSON,
  POTS_JSON,
  SCHEDULED_JSON,
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
