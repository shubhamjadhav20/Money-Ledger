import { TestBed } from '@angular/core/testing';
import { parseLocalDate, paise } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import { AuthStore } from '../api/auth';
import type { CapturedView } from '../api/models';
import { TODAY } from '../month';
import { fakeApi } from '../../testing-api';
import { must } from '../../testing';
import { KEEP_ADDED, QuickAddStore } from './quick-add-store';

function setup(over: Parameters<typeof fakeApi>[0] = {}, captureOnly = false) {
  const api = fakeApi(over);
  TestBed.configureTestingModule({
    providers: [
      QuickAddStore,
      { provide: ApiClient, useValue: api },
      { provide: TODAY, useValue: parseLocalDate('2026-11-17', 'yyyy-mm-dd') },
    ],
  });
  TestBed.inject(AuthStore).connect('tok', { captureOnly });
  return { api, store: TestBed.inject(QuickAddStore) };
}

const saved = (category: string, memo = ''): CapturedView => ({
  id: `id-${category}`,
  date: parseLocalDate('2026-11-17', 'yyyy-mm-dd'),
  amountPaise: paise(-10_000),
  method: 'upi',
  category,
  kind: 'spend',
  memo,
  status: 'pending',
});

function fill(store: QuickAddStore, amount = '450', category = 'dinner'): void {
  store.amount.set(amount);
  store.category.set(category);
}

describe('QuickAddStore', () => {
  describe('reading the form', () => {
    it('says nothing until something is typed', () => {
      const { store } = setup();
      expect(store.reading()).toBeNull();
      expect(store.canSave()).toBe(false);
    });

    it('reads the fields with the shared grammar', () => {
      const { store } = setup();
      fill(store);
      store.method.set('cash');
      store.day.set('yesterday');
      expect(store.text()).toBe('450 dinner cash yesterday');
      expect(store.reading()).toMatchObject({
        ok: true,
        entry: { amount: -45_000, method: 'cash', date: '2026-11-16', category: 'dinner' },
      });
      expect(store.canSave()).toBe(true);
    });

    it('explains what is missing and does not allow saving', () => {
      const { store } = setup();
      store.amount.set('450');
      expect(store.reading()).toEqual({
        ok: false,
        error: 'Missing category: e.g. "20 food upi"',
      });
      expect(store.canSave()).toBe(false);
    });

    it('received money reads as income', () => {
      const { store } = setup();
      fill(store, '5000', 'salary');
      store.direction.set('received');
      expect(store.reading()).toMatchObject({
        ok: true,
        entry: { kind: 'income', amount: 500_000 },
      });
    });
  });

  describe('saving', () => {
    it('sends the line, lists the entry, clears the fields and keeps method and day', async () => {
      const { api, store } = setup();
      fill(store);
      store.note.set('with friends');
      store.method.set('card');
      store.day.set('yesterday');
      expect(await store.save()).toBe(true);
      expect(api.capture).toHaveBeenCalledWith('450 dinner with friends card yesterday', undefined);
      expect(store.added()).toHaveLength(1);
      expect([store.amount(), store.category(), store.note()]).toEqual(['', '', '']);
      expect([store.method(), store.day()]).toEqual(['card', 'yesterday']);
      expect(store.reading()).toBeNull();
      expect(store.saving()).toBe(false);
    });

    it('sends the chosen account', async () => {
      const { api, store } = setup();
      fill(store);
      store.accountId.set('acc-bank');
      await store.save();
      expect(api.capture).toHaveBeenCalledWith('450 dinner upi today', 'acc-bank');
    });

    it('does nothing while the form does not read', async () => {
      const { api, store } = setup();
      store.amount.set('450');
      expect(await store.save()).toBe(false);
      expect(api.capture).not.toHaveBeenCalled();
    });

    it('does not send twice while a save is on its way', async () => {
      let release: (value: CapturedView) => void = () => undefined;
      const { api, store } = setup({
        capture: () => new Promise<CapturedView>((resolve) => (release = resolve)),
      });
      fill(store);
      const first = store.save();
      expect(store.saving()).toBe(true);
      expect(await store.save()).toBe(false);
      release(saved('dinner'));
      expect(await first).toBe(true);
      expect(api.capture).toHaveBeenCalledTimes(1);
    });

    it('keeps the newest entries first and only the last few', async () => {
      let n = 0;
      const { store } = setup({ capture: () => Promise.resolve(saved(`cat${String(++n)}`)) });
      for (let i = 0; i < KEEP_ADDED + 2; i++) {
        fill(store);
        await store.save();
      }
      expect(store.added()).toHaveLength(KEEP_ADDED);
      expect(must(store.added()[0]).category).toBe(`cat${String(KEEP_ADDED + 2)}`);
    });

    it('offers recent categories once each, most recent first', async () => {
      const categories = ['food', 'fuel', 'food', 'rent'];
      let n = 0;
      const { store } = setup({
        capture: () => Promise.resolve(saved(must(categories[n++]))),
      });
      for (let saves = categories.length; saves > 0; saves--) {
        fill(store);
        await store.save();
      }
      expect(store.recentCategories()).toEqual(['rent', 'food', 'fuel']);
    });
  });

  describe('when saving fails', () => {
    const failWith = (status: number, code: string, message: string) => ({
      capture: () => Promise.reject(new ApiError(status, code, message)),
    });

    it('shows the server reason for refused text and keeps what was typed', async () => {
      const reason = 'You have more than one bank account: say which one to use for upi';
      const { store } = setup(failWith(422, 'invalid_capture', reason));
      fill(store);
      expect(await store.save()).toBe(false);
      expect(store.failure()).toBe(reason);
      expect(store.amount()).toBe('450');
      expect(store.added()).toHaveLength(0);
    });

    it('explains a token that may not add entries', async () => {
      const { store } = setup(failWith(403, 'forbidden', 'needs capture scope'));
      fill(store);
      await store.save();
      expect(store.failure()).toBe(
        'This token cannot add entries. Connect with a capture or full-access token.',
      );
    });

    it('explains the rate limit', async () => {
      const { store } = setup(failWith(429, 'rate_limited', 'Too many requests, slow down'));
      fill(store);
      await store.save();
      expect(store.failure()).toBe('Too many entries too fast. Wait a minute and try again.');
    });

    it('clears the reason on the next try', async () => {
      let first = true;
      const { store } = setup({
        capture: () =>
          first
            ? ((first = false),
              Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server')))
            : Promise.resolve(saved('dinner')),
      });
      fill(store);
      await store.save();
      expect(store.failure()).toBe('Could not reach the server');
      await store.save();
      expect(store.failure()).toBeNull();
    });
  });

  describe('accounts', () => {
    it('loads them for a token that can read', async () => {
      const { api, store } = setup();
      await store.loadAccounts();
      expect(store.accounts().map((a) => a.name)).toEqual(['HDFC Bank', 'ICICI card', 'Cash']);
      expect(api.balances).toHaveBeenCalledTimes(1);
    });

    it('does not even ask with a capture-only token', async () => {
      const { api, store } = setup({}, true);
      await store.loadAccounts();
      expect(api.balances).not.toHaveBeenCalled();
      expect(store.accounts()).toEqual([]);
    });

    it('goes without the choice when accounts cannot be read', async () => {
      const { store } = setup({
        balances: () => Promise.reject(new ApiError(403, 'forbidden', 'no')),
      });
      await store.loadAccounts();
      expect(store.accounts()).toEqual([]);
    });
  });
});
