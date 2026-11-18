import { TestBed } from '@angular/core/testing';
import { paise } from '@ledger/core';
import { ApiClient, ApiError } from '../api/api-client';
import { PAYDAY_SPLIT, POTS, SCHEDULED, SETTINGS, fakeApi } from '../../testing-api';
import { NEW_RUN_ID, PaydayStore } from './payday-store';

function setup(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(over);
  let n = 0;
  TestBed.configureTestingModule({
    providers: [
      PaydayStore,
      { provide: ApiClient, useValue: api },
      { provide: NEW_RUN_ID, useValue: () => `run-${String(++n)}` },
    ],
  });
  return { api, store: TestBed.inject(PaydayStore) };
}

const forbidden = () => Promise.reject(new ApiError(403, 'forbidden', 'needs full'));

describe('PaydayStore', () => {
  describe('loading', () => {
    it('loads settings, rules, pots and scheduled items together', async () => {
      const { api, store } = setup();
      expect(store.state()).toBe('loading');
      await store.load();
      expect(store.state()).toBe('ready');
      expect(store.settings()).toEqual(SETTINGS);
      expect(store.rules().map((r) => r.name)).toEqual([
        'Emergency buffer',
        'Investing',
        'Spending',
      ]);
      expect(store.pots()).toEqual(POTS);
      expect(store.scheduled()).toEqual(SCHEDULED);
      for (const call of [api.settings, api.paydayRules, api.pots, api.scheduled]) {
        expect(call).toHaveBeenCalledTimes(1);
      }
    });

    it('shows the reason when the page cannot be loaded', async () => {
      const { store } = setup({
        settings: () =>
          Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server')),
      });
      await store.load();
      expect(store.state()).toBe('error');
      expect(store.error()).toBe('Could not reach the server');
    });

    it('keeps what is on screen when a quiet reload fails', async () => {
      let fail = false;
      const { store } = setup({
        scheduled: () =>
          fail ? Promise.reject(new ApiError(500, 'x', 'Oops')) : Promise.resolve(SCHEDULED),
      });
      await store.load();
      fail = true;
      await store.load(true);
      expect(store.state()).toBe('ready');
      expect(store.scheduled()).toHaveLength(3);
    });

    it('drops an old answer that arrives after a newer one', async () => {
      let calls = 0;
      let releaseOld: (items: typeof SCHEDULED) => void = () => undefined;
      const { store } = setup({
        scheduled: () => {
          calls += 1;
          return calls === 1
            ? new Promise((resolve) => {
                releaseOld = resolve;
              })
            : Promise.resolve(SCHEDULED);
        },
      });
      const older = store.load();
      await store.load(true);
      releaseOld([]);
      await older;
      expect(store.scheduled()).toHaveLength(3);
    });
  });

  describe('settings', () => {
    it('saves a change and shows the settings the server answers with', async () => {
      const { api, store } = setup();
      await store.load();
      expect(await store.saveSettings({ paydayDay: 5 })).toBe(true);
      expect(api.updateSettings).toHaveBeenCalledWith({ paydayDay: 5 });
      expect(store.settings()?.paydayDay).toBe(5);
      expect(store.saving()).toBe(false);
    });

    it('keeps the reason on the settings card when a read-only token tries', async () => {
      const { store } = setup({ updateSettings: forbidden });
      await store.load();
      expect(await store.saveSettings({ paydayDay: 5 })).toBe(false);
      expect(store.failureFor('settings')).toMatch(/full-access token/);
      expect(store.failureFor('rules')).toBeNull();
      expect(store.settings()?.paydayDay).toBe(7);
    });

    it('does nothing while another change is still being saved', async () => {
      let release: () => void = () => undefined;
      const { api, store } = setup({
        updateSettings: () =>
          new Promise((resolve) => {
            release = () => {
              resolve(SETTINGS);
            };
          }),
      });
      await store.load();
      const first = store.saveSettings({ paydayDay: 5 });
      expect(await store.saveSettings({ paydayDay: 6 })).toBe(false);
      release();
      await first;
      expect(api.updateSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('rules', () => {
    it('replaces the rules and drops a preview worked out with the old ones', async () => {
      const { api, store } = setup();
      await store.load();
      await store.previewSalary(paise(8_000_000));
      expect(store.preview()).not.toBeNull();
      const rules = [{ kind: 'remainder', name: 'Spending' }] as const;
      expect(await store.saveRules(rules)).toBe(true);
      expect(api.setPaydayRules).toHaveBeenCalledWith(rules);
      expect(store.preview()).toBeNull();
    });

    it('keeps the old rules and says why when saving fails', async () => {
      const { store } = setup({
        setPaydayRules: () =>
          Promise.reject(new ApiError(422, 'invalid_rules', 'Shares add up to more than 100%')),
      });
      await store.load();
      expect(await store.saveRules([{ kind: 'remainder', name: 'x' }])).toBe(false);
      expect(store.failureFor('rules')).toBe('Shares add up to more than 100%');
      expect(store.rules()).toHaveLength(3);
    });
  });

  describe('a payday run', () => {
    it('previews a salary with a fresh run id and changes nothing on the server', async () => {
      const { api, store } = setup();
      await store.load();
      expect(await store.previewSalary(paise(8_000_000))).toBe(true);
      expect(api.previewPayday).toHaveBeenCalledWith(8_000_000);
      expect(store.preview()).toEqual({
        amountPaise: 8_000_000,
        split: PAYDAY_SPLIT,
        runId: 'run-1',
      });
      expect(api.applyPayday).not.toHaveBeenCalled();
    });

    it('applies the preview with its run id, then clears it and reloads the pots', async () => {
      const { api, store } = setup();
      await store.load();
      await store.previewSalary(paise(8_000_000));
      expect(await store.applyPreview()).toBe(true);
      expect(api.applyPayday).toHaveBeenCalledWith({ runId: 'run-1', amountPaise: 8_000_000 });
      expect(store.preview()).toBeNull();
      expect(store.applied()?.runId).toBe('run-1');
      expect(api.pots).toHaveBeenCalledTimes(2);
    });

    it('keeps the preview and its run id when applying fails, so a retry cannot double up', async () => {
      let fail = true;
      const { api, store } = setup({
        applyPayday: (input) =>
          fail
            ? Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server'))
            : Promise.resolve({ runId: input.runId, replayed: true, result: PAYDAY_SPLIT }),
      });
      await store.load();
      await store.previewSalary(paise(8_000_000));
      expect(await store.applyPreview()).toBe(false);
      expect(store.failureFor('run')).toBe('Could not reach the server');
      expect(store.preview()?.runId).toBe('run-1');

      fail = false;
      expect(await store.applyPreview()).toBe(true);
      expect(api.applyPayday).toHaveBeenNthCalledWith(2, {
        runId: 'run-1',
        amountPaise: 8_000_000,
      });
      expect(store.applied()?.replayed).toBe(true);
    });

    it('does nothing when there is no preview to apply', async () => {
      const { api, store } = setup();
      await store.load();
      expect(await store.applyPreview()).toBe(false);
      expect(api.applyPayday).not.toHaveBeenCalled();
    });

    it('gives each new preview its own run id and forgets the last result', async () => {
      const { store } = setup();
      await store.load();
      await store.previewSalary(paise(8_000_000));
      await store.applyPreview();
      await store.previewSalary(paise(9_000_000));
      expect(store.preview()?.runId).toBe('run-2');
      expect(store.applied()).toBeNull();
    });

    it('can discard a preview and clear its error', async () => {
      const { store } = setup({ applyPayday: forbidden });
      await store.load();
      await store.previewSalary(paise(100));
      await store.applyPreview();
      expect(store.failureFor('run')).not.toBeNull();
      store.discardPreview();
      expect(store.preview()).toBeNull();
      expect(store.failureFor('run')).toBeNull();
    });

    it("discarding leaves another card's error alone", async () => {
      const { store } = setup({ updateSettings: forbidden });
      await store.load();
      await store.saveSettings({ paydayDay: 5 });
      store.discardPreview();
      expect(store.failureFor('settings')).not.toBeNull();
    });

    it('can dismiss the result', async () => {
      const { store } = setup();
      await store.load();
      await store.previewSalary(paise(100));
      await store.applyPreview();
      store.dismissApplied();
      expect(store.applied()).toBeNull();
    });
  });

  describe('scheduled', () => {
    it('adds an item and reloads the list', async () => {
      const { api, store } = setup();
      await store.load();
      const input = { name: 'Gym', amountPaise: paise(100_000), monthlyDay: 3 };
      expect(await store.addScheduled(input)).toBe(true);
      expect(api.addScheduled).toHaveBeenCalledWith(input);
      expect(api.scheduled).toHaveBeenCalledTimes(2);
    });

    it('removes an item and reloads the list', async () => {
      const { api, store } = setup();
      await store.load();
      expect(await store.removeScheduled('s-tv')).toBe(true);
      expect(api.deleteScheduled).toHaveBeenCalledWith('s-tv');
      expect(api.scheduled).toHaveBeenCalledTimes(2);
    });

    it('says why when it cannot remove one', async () => {
      const { store } = setup({
        deleteScheduled: () =>
          Promise.reject(new ApiError(404, 'not_found', 'No such scheduled item')),
      });
      await store.load();
      expect(await store.removeScheduled('gone')).toBe(false);
      expect(store.failureFor('scheduled')).toBe('No such scheduled item');
    });

    it('explains a non-API failure in plain words', async () => {
      const { store } = setup({ addScheduled: () => Promise.reject(new Error('boom')) });
      await store.load();
      await store.addScheduled({ name: 'x', amountPaise: paise(1), monthlyDay: 1 });
      expect(store.failureFor('scheduled')).toBe('Something went wrong');
    });
  });
});
