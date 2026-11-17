import { TestBed } from '@angular/core/testing';
import { paise } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import type { PotView } from '../api/models';
import { CARD_POT_JSON, MOVEMENTS, POTS, decodePotFixture, fakeApi } from '../../testing-api';
import { must } from '../../testing';
import { PotsStore } from './pots-store';

function setup(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(over);
  TestBed.configureTestingModule({
    providers: [PotsStore, { provide: ApiClient, useValue: api }],
  });
  return { api, store: TestBed.inject(PotsStore) };
}

const forbidden = () => Promise.reject(new ApiError(403, 'forbidden', 'This token cannot do that'));

describe('PotsStore', () => {
  describe('loading', () => {
    it('loads the pots and the card accounts together', async () => {
      const { api, store } = setup();
      expect(store.state()).toBe('loading');
      await store.load();
      expect(store.state()).toBe('ready');
      expect(store.pots().map((p) => p.name)).toEqual(['Emergency buffer', 'Rent']);
      expect(store.cards().map((c) => c.name)).toEqual(['ICICI card']);
      expect(api.pots).toHaveBeenCalledTimes(1);
      expect(api.balances).toHaveBeenCalledTimes(1);
    });

    it('names the card a pot covers, and says "a card" if that card is gone', async () => {
      const covering: PotView = decodePotFixture(CARD_POT_JSON);
      const { store } = setup({ pots: () => Promise.resolve([...POTS, covering]) });
      await store.load();
      expect(store.cardName(covering)).toBe('ICICI card');
      expect(store.cardName({ ...covering, coversCardAccountId: 'acc-gone' })).toBe('a card');
      expect(store.cardName(must(POTS[0]))).toBeNull();
    });

    it('shows the reason when the pots cannot be loaded', async () => {
      const { store } = setup({
        pots: () => Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server')),
      });
      await store.load();
      expect(store.state()).toBe('error');
      expect(store.error()).toBe('Could not reach the server');
    });

    it('keeps what is on screen when a quiet reload fails', async () => {
      let fail = false;
      const { store } = setup({
        pots: () => (fail ? Promise.reject(new ApiError(500, 'x', 'Oops')) : Promise.resolve(POTS)),
      });
      await store.load();
      fail = true;
      await store.load(true);
      expect(store.state()).toBe('ready');
      expect(store.pots()).toHaveLength(2);
    });

    it('drops an old answer that arrives after a newer one', async () => {
      let calls = 0;
      let releaseOld: (pots: PotView[]) => void = () => undefined;
      const { store } = setup({
        pots: () => {
          calls += 1;
          return calls === 1
            ? new Promise((resolve) => {
                releaseOld = resolve;
              })
            : Promise.resolve(POTS);
        },
      });
      const older = store.load();
      await store.load(true);
      expect(store.pots()).toHaveLength(2);
      releaseOld([]);
      await older;
      expect(store.pots()).toHaveLength(2);
    });
  });

  describe('changing pots', () => {
    it('creates a pot and reloads the list', async () => {
      const { api, store } = setup();
      await store.load();
      const ok = await store.create({ name: 'Trip', kind: 'spend', targetPaise: paise(500_000) });
      expect(ok).toBe(true);
      expect(api.createPot).toHaveBeenCalledWith({
        name: 'Trip',
        kind: 'spend',
        targetPaise: 500_000,
      });
      expect(api.pots).toHaveBeenCalledTimes(2);
      expect(store.saving()).toBe(false);
      expect(store.state()).toBe('ready');
    });

    it('edits a pot and reloads the list', async () => {
      const { api, store } = setup();
      await store.load();
      expect(await store.update('pot-rent', { dueDate: null })).toBe(true);
      expect(api.updatePot).toHaveBeenCalledWith('pot-rent', { dueDate: null });
      expect(api.pots).toHaveBeenCalledTimes(2);
    });

    it('moves money and reloads so the balance is the server’s', async () => {
      const { api, store } = setup();
      await store.load();
      expect(await store.move('pot-buffer', { amountPaise: paise(-5_000), reason: 'spend' })).toBe(
        true,
      );
      expect(api.addPotMovement).toHaveBeenCalledWith('pot-buffer', {
        amountPaise: -5_000,
        reason: 'spend',
      });
      expect(api.pots).toHaveBeenCalledTimes(2);
    });

    it('refreshes a history that is already open after moving money', async () => {
      const { api, store } = setup();
      await store.load();
      await store.loadHistory('pot-buffer');
      await store.move('pot-buffer', { amountPaise: paise(1_000), reason: 'manual' });
      expect(api.potMovements).toHaveBeenCalledTimes(2);
    });

    it('does not load a history nobody opened', async () => {
      const { api, store } = setup();
      await store.load();
      await store.move('pot-buffer', { amountPaise: paise(1_000), reason: 'manual' });
      expect(api.potMovements).not.toHaveBeenCalled();
    });

    it.each([
      [403, 'Changing pots needs a full-access token. Connect with one to make changes.'],
      [422, 'Only bill pots can have a due date'],
    ])('explains a %i and reports that nothing was saved', async (status, expected) => {
      const { store } = setup({
        createPot: () =>
          Promise.reject(new ApiError(status, 'x', 'Only bill pots can have a due date')),
      });
      await store.load();
      expect(await store.create({ name: 'x', kind: 'spend' })).toBe(false);
      expect(store.saveError()).toBe(expected);
      expect(store.saving()).toBe(false);
    });

    it('clears an old failure before the next try', async () => {
      let fail = true;
      const { store } = setup({
        updatePot: (id, change) =>
          fail
            ? forbidden()
            : Promise.resolve({ ...must(POTS.find((p) => p.id === id)), ...change }),
      });
      await store.load();
      await store.update('pot-rent', { name: 'House rent' });
      expect(store.saveError()).not.toBeNull();
      fail = false;
      await store.update('pot-rent', { name: 'House rent' });
      expect(store.saveError()).toBeNull();
    });

    it('ignores a second change while one is being saved', async () => {
      let release: () => void = () => undefined;
      const { api, store } = setup({
        createPot: () =>
          new Promise<string>((resolve) => {
            release = () => {
              resolve('pot-new');
            };
          }),
      });
      await store.load();
      const first = store.create({ name: 'A', kind: 'spend' });
      expect(store.saving()).toBe(true);
      expect(await store.create({ name: 'B', kind: 'spend' })).toBe(false);
      release();
      expect(await first).toBe(true);
      expect(api.createPot).toHaveBeenCalledTimes(1);
    });
  });

  describe('history', () => {
    it('lists the newest entries first', async () => {
      const { store } = setup();
      await store.loadHistory('pot-buffer');
      const history = must(store.histories()['pot-buffer']);
      expect(history.state).toBe('ready');
      expect(history.items.map((m) => m.id)).toEqual(['m-2', 'm-1']);
      expect(MOVEMENTS.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    });

    it('keeps the earlier lines and says so when a refresh fails', async () => {
      let fail = false;
      const { store } = setup({
        potMovements: () =>
          fail ? Promise.reject(new ApiError(0, 'x', 'down')) : Promise.resolve(MOVEMENTS),
      });
      await store.loadHistory('pot-buffer');
      fail = true;
      await store.loadHistory('pot-buffer');
      const history = must(store.histories()['pot-buffer']);
      expect(history.state).toBe('error');
      expect(history.items).toHaveLength(2);
    });

    it('keeps each pot’s history separate', async () => {
      const { store } = setup();
      await store.loadHistory('pot-buffer');
      await store.loadHistory('pot-rent');
      expect(Object.keys(store.histories()).sort()).toEqual(['pot-buffer', 'pot-rent']);
    });
  });
});
