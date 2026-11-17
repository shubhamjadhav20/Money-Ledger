import { TestBed } from '@angular/core/testing';
import { paise } from '@ledger/core';
import { must } from '../../testing';
import { ApiClient, ApiError } from '../api/api-client';
import type { FreeResult } from '../api/api-client';
import { BALANCES, FREE, MISSING_JSON, fakeApi } from '../../testing-api';
import { decodeMissing } from '../api/models';
import { DashboardStore } from './dashboard-store';

function setup(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(over);
  TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
  return { api, store: TestBed.inject(DashboardStore) };
}

const missing: FreeResult = { kind: 'missing-balances', accounts: decodeMissing(MISSING_JSON) };

describe('DashboardStore', () => {
  it('starts idle and empty', () => {
    const { store } = setup();
    expect(store.status()).toBe('idle');
    expect(store.view()).toBeNull();
    expect(store.cardDues()).toEqual([]);
    expect(store.upcoming()).toEqual([]);
  });

  it('loads everything and derives today from the free-to-spend answer', async () => {
    const { store } = setup();
    await store.load();
    expect(store.status()).toBe('ready');
    expect(store.view()?.freePaise).toBe(3_250_000);
    expect(store.forecast()?.runwayDays).toBe(27);
    expect(store.pots()).toHaveLength(2);
    expect(store.today()).toBe('2026-11-17');
  });

  it('lists card dues with the amount owed and the next due date', async () => {
    const { store } = setup();
    await store.load();
    expect(store.cardDues()).toEqual([
      { accountId: 'acc-card', name: 'ICICI card', owedPaise: 1_200_000, nextDue: '2026-12-08' },
    ]);
  });

  it('skips a card that owes nothing, or has no balance or cycle yet', async () => {
    const [bank, card, cash] = BALANCES;
    const { store } = setup({
      balances: () =>
        Promise.resolve([
          must(bank),
          { ...must(card), balancePaise: paise(50_000) },
          { ...must(card), accountId: 'c2', balancePaise: null },
          { ...must(card), accountId: 'c3', cycle: null, balancePaise: paise(-1) },
          must(cash),
        ]),
    });
    await store.load();
    expect(store.cardDues()).toEqual([]);
  });

  it('lists what falls due before payday, in date order', async () => {
    const { store } = setup();
    await store.load();
    expect(store.upcoming().map((o) => `${o.name} ${o.date}`)).toEqual([
      'Streaming 2026-11-25',
      'Insurance premium 2026-11-28',
      'Rent 2026-12-01',
    ]);
  });

  it('asks for the missing balances instead of failing, and skips the forecast', async () => {
    const { store, api } = setup({ free: () => Promise.resolve(missing) });
    await store.load();
    expect(store.status()).toBe('ready');
    expect(store.view()).toBeNull();
    expect(store.missing()).toEqual([{ accountId: 'acc-card', name: 'ICICI card' }]);
    expect(store.forecast()).toBeNull();
    expect(api.forecast).not.toHaveBeenCalled();
    expect(store.cardDues()).toEqual([]);
  });

  it('reports a failed load by the server message, and recovers on retry', async () => {
    let fail = true;
    const { store } = setup({
      pots: () =>
        fail
          ? Promise.reject(new ApiError(500, 'internal', 'The ledger is down'))
          : Promise.resolve([]),
    });
    await store.load();
    expect(store.status()).toBe('error');
    expect(store.error()).toBe('The ledger is down');

    fail = false;
    await store.load();
    expect(store.status()).toBe('ready');
    expect(store.error()).toBeNull();
  });

  it('falls back to a plain message for an unexpected failure', async () => {
    const { store } = setup({ balances: () => Promise.reject(new Error('boom')) });
    await store.load();
    expect(store.error()).toBe('Could not load the dashboard');
  });

  describe('saving balances', () => {
    const entries = [
      { accountId: 'acc-bank', amountPaise: paise(4_600_000) },
      { accountId: 'acc-card', amountPaise: paise(-900_000) },
    ];

    it('records each balance in order, then reloads', async () => {
      const { store, api } = setup();
      await store.load();
      api.free.mockClear();

      expect(await store.saveBalances(entries)).toBe(true);
      expect(api.recordBalance.mock.calls).toEqual([
        ['acc-bank', 4_600_000],
        ['acc-card', -900_000],
      ]);
      expect(api.free).toHaveBeenCalledTimes(1);
      expect(store.saving()).toBe(false);
      expect(store.saveError()).toBeNull();
    });

    it('tells a read-only token how to fix it, and does not reload', async () => {
      const { store, api } = setup({
        recordBalance: () => Promise.reject(new ApiError(403, 'forbidden', 'Needs full')),
      });
      expect(await store.saveBalances(entries)).toBe(false);
      expect(store.saveError()).toBe(
        'This token can only read. Connect with a full-access token to record balances.',
      );
      expect(api.free).not.toHaveBeenCalled();
      expect(store.saving()).toBe(false);
    });

    it('stops at the first failure and shows the server message', async () => {
      const { store, api } = setup({
        recordBalance: () => Promise.reject(new ApiError(400, 'invalid', 'Amount too large')),
      });
      expect(await store.saveBalances(entries)).toBe(false);
      expect(api.recordBalance).toHaveBeenCalledTimes(1);
      expect(store.saveError()).toBe('Amount too large');
    });
  });

  it('exposes the fixture free-to-spend through the typed view', async () => {
    const { store } = setup();
    await store.load();
    expect(store.view()).toEqual(FREE);
  });
});
