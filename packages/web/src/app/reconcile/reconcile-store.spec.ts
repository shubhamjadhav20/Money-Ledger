import { TestBed } from '@angular/core/testing';
import { ApiClient, ApiError } from '../api/api-client';
import type { ReconcileView } from '../api/models';
import { CURRENT_MONTH } from '../month';
import { RECONCILE, fakeApi } from '../../testing-api';
import { ReconcileStore } from './reconcile-store';

function setup(over: Parameters<typeof fakeApi>[0] = {}, month = '2026-11') {
  const api = fakeApi(over);
  TestBed.configureTestingModule({
    providers: [
      ReconcileStore,
      { provide: ApiClient, useValue: api },
      { provide: CURRENT_MONTH, useValue: month },
    ],
  });
  return { api, store: TestBed.inject(ReconcileStore) };
}

const nothing: ReconcileView = {
  ...RECONCILE,
  bundles: [],
  unmatched: [],
  singleCount: 3,
  transactions: new Map(),
};

describe('ReconcileStore', () => {
  it('asks for the whole of the opening month, and for the account names', async () => {
    const { api, store } = setup();
    expect(store.status()).toBe('loading');
    await store.load();
    expect(api.reconcile).toHaveBeenCalledWith('2026-11-01', '2026-11-30');
    expect(api.balances).toHaveBeenCalledTimes(1);
    expect(store.status()).toBe('ready');
  });

  it('sorts what it finds into the three lists and counts the payments to review', async () => {
    const { store } = setup();
    await store.load();
    expect(store.toCheck().map((g) => g.bundle.id)).toEqual([
      'bundle:t-g1+t-g2+t-g3+t-g4',
      'bundle:t-dinner+t-friend',
    ]);
    expect(store.matched().map((g) => g.bundle.id)).toEqual(['bundle:t-flight+t-refund']);
    expect(store.review()).toHaveLength(1);
    expect(store.reviewCount()).toBe(3);
    expect(store.singleCount()).toBe(14);
    expect(store.nothingToMatch()).toBe(false);
  });

  it('names accounts, and says so when one is unknown', async () => {
    const { store } = setup();
    await store.load();
    expect(store.accountName('acc-bank')).toBe('HDFC Bank');
    expect(store.accountName('acc-gone')).toBe('Unknown account');
  });

  it('knows when there is nothing to match', async () => {
    const { store } = setup({ reconcile: () => Promise.resolve(nothing) });
    await store.load();
    expect(store.nothingToMatch()).toBe(true);
    expect(store.singleCount()).toBe(3);
  });

  it('shows the reason when the month cannot be loaded, and can be retried', async () => {
    let fail = true;
    const { store } = setup({
      reconcile: () =>
        fail
          ? Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server'))
          : Promise.resolve(RECONCILE),
    });
    await store.load();
    expect([store.status(), store.error()]).toEqual(['error', 'Could not reach the server']);
    fail = false;
    await store.load();
    expect([store.status(), store.error()]).toEqual(['ready', null]);
  });

  it('steps back a month, but never past the current one', async () => {
    const { api, store } = setup();
    await store.load();
    expect(store.canGoForward()).toBe(false);
    await store.goToMonth(1);
    expect(api.reconcile).toHaveBeenCalledTimes(1);
    await store.goToMonth(-1);
    expect(store.month()).toBe('2026-10');
    expect(api.reconcile).toHaveBeenLastCalledWith('2026-10-01', '2026-10-31');
    expect(store.canGoForward()).toBe(true);
    await store.goToMonth(1);
    expect(store.month()).toBe('2026-11');
  });

  it('drops an old answer that arrives after a newer one', async () => {
    let calls = 0;
    let releaseOld: (view: ReconcileView) => void = () => undefined;
    const { store } = setup({
      reconcile: () => {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => {
              releaseOld = resolve;
            })
          : Promise.resolve(RECONCILE);
      },
    });
    const older = store.load();
    await store.goToMonth(-1);
    expect(store.view()?.bundles).toHaveLength(3);
    releaseOld(nothing);
    await older;
    expect(store.view()?.bundles).toHaveLength(3);
    expect(store.status()).toBe('ready');
  });
});
