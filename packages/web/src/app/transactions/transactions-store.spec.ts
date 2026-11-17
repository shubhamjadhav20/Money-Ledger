import { TestBed } from '@angular/core/testing';
import { ApiClient, ApiError } from '../api/api-client';
import { CURRENT_MONTH } from '../month';
import { SUMMARY, TRANSACTIONS, fakeApi } from '../../testing-api';
import { must } from '../../testing';
import { PAGE_LIMIT, TransactionsStore } from './transactions-store';

function setup(over: Parameters<typeof fakeApi>[0] = {}, month = '2026-11') {
  const api = fakeApi(over);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: CURRENT_MONTH, useValue: month },
    ],
  });
  return { api, store: TestBed.inject(TransactionsStore) };
}

describe('TransactionsStore', () => {
  it('opens on the current month and loads the month, its summary and the account names', async () => {
    const { api, store } = setup();
    expect(store.status()).toBe('idle');
    await store.load();
    expect(store.status()).toBe('ready');
    expect(api.transactions).toHaveBeenCalledWith({
      from: '2026-11-01',
      to: '2026-11-30',
      limit: PAGE_LIMIT,
    });
    expect(api.summary).toHaveBeenCalledWith('2026-11');
    expect(store.rows()).toHaveLength(5);
    expect(store.summary()?.spendPaise).toBe(190_000);
    expect(store.accountName('acc-card')).toBe('ICICI card');
    expect(store.accountName('gone')).toBe('Unknown account');
  });

  it('goes back a month, but never forward past the current one', async () => {
    const { api, store } = setup();
    await store.load();
    expect(store.canGoForward()).toBe(false);
    await store.goToMonth(1);
    expect(store.month()).toBe('2026-11');
    expect(api.summary).toHaveBeenCalledTimes(1);

    await store.goToMonth(-1);
    expect(store.month()).toBe('2026-10');
    expect(api.transactions).toHaveBeenLastCalledWith({
      from: '2026-10-01',
      to: '2026-10-31',
      limit: PAGE_LIMIT,
    });
    expect(store.canGoForward()).toBe(true);

    await store.goToMonth(1);
    expect(store.month()).toBe('2026-11');
  });

  it('crosses a year boundary', async () => {
    const { store } = setup({}, '2027-01');
    await store.goToMonth(-1);
    expect(store.month()).toBe('2026-12');
  });

  it('searches and filters by status on the server, trimming the text', async () => {
    const { api, store } = setup();
    await store.applySearch('  swiggy ');
    expect(store.search()).toBe('swiggy');
    await store.setStatus('pending');
    expect(api.transactions).toHaveBeenLastCalledWith({
      from: '2026-11-01',
      to: '2026-11-30',
      limit: PAGE_LIMIT,
      search: 'swiggy',
      status: 'pending',
    });
    expect(store.filtering()).toBe(true);
  });

  it('filters by kind on the page without asking the server again', async () => {
    const { api, store } = setup();
    await store.load();
    api.transactions.mockClear();
    store.setKind('transfer');
    expect(store.visible().map((t) => t.id)).toEqual(['t-cardpay']);
    expect(api.transactions).not.toHaveBeenCalled();
    store.setKind('all');
    expect(store.visible()).toHaveLength(5);
  });

  it('clears every filter and reloads', async () => {
    const { api, store } = setup();
    await store.applySearch('x');
    await store.setStatus('posted');
    store.setKind('income');
    await store.clearFilters();
    expect([store.search(), store.statusFilter(), store.kindFilter(), store.filtering()]).toEqual([
      '',
      'all',
      'all',
      false,
    ]);
    expect(api.transactions).toHaveBeenLastCalledWith({
      from: '2026-11-01',
      to: '2026-11-30',
      limit: PAGE_LIMIT,
    });
  });

  it('says when the page is full and there may be more', async () => {
    const many = Array.from({ length: PAGE_LIMIT }, (_, i) => ({
      ...must(TRANSACTIONS[0]),
      id: `t${String(i)}`,
    }));
    const { store } = setup({ transactions: () => Promise.resolve(many) });
    await store.load();
    expect(store.truncated()).toBe(true);
  });

  it('shows the biggest categories and counts the rest', async () => {
    const lots = Array.from({ length: 11 }, (_, i) => ({
      category: `Cat ${String(i)}`,
      spentPaise: must(SUMMARY.spendPaise),
      fixed: false,
    }));
    const { store } = setup({
      summary: () => Promise.resolve({ ...SUMMARY, spendByCategory: lots }),
    });
    await store.load();
    expect(store.topCategories()).toHaveLength(8);
    expect(store.moreCategories()).toBe(3);
  });

  it('lists the category names in use, once each and sorted, without the Uncategorised placeholder', async () => {
    const { store } = setup();
    await store.load();
    expect(store.categoryNames()).toEqual(['Food', 'Salary']);
  });

  it('reports a failed load by the server message', async () => {
    const { store } = setup({
      summary: () => Promise.reject(new ApiError(500, 'internal', 'Down')),
    });
    await store.load();
    expect([store.status(), store.error()]).toEqual(['error', 'Down']);
  });

  it('ignores an old answer that arrives after a newer request', async () => {
    let releaseOld: (rows: typeof TRANSACTIONS) => void = () => undefined;
    let calls = 0;
    const { store } = setup({
      transactions: () => {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => {
              releaseOld = resolve;
            })
          : Promise.resolve([must(TRANSACTIONS[0])]);
      },
    });
    const first = store.load();
    await store.load();
    expect(store.rows()).toHaveLength(1);
    releaseOld(TRANSACTIONS);
    await first;
    expect(store.rows()).toHaveLength(1);
  });

  describe('editing', () => {
    it("keeps the server's version of the row, then refreshes the month without a loading flash", async () => {
      let saved = [...TRANSACTIONS];
      const seen: string[] = [];
      const live: { store: TransactionsStore | undefined } = { store: undefined };
      const { api, store } = setup({
        transactions: () => Promise.resolve(saved),
        summary: () => {
          seen.push(live.store?.status() ?? 'unset');
          return Promise.resolve(SUMMARY);
        },
        updateTransaction: (id, change) => {
          saved = saved.map((row) => (row.id === id ? { ...row, ...change } : row));
          return Promise.resolve(must(saved.find((row) => row.id === id)));
        },
      });
      live.store = store;
      await store.load();
      seen.length = 0;
      api.summary.mockClear();

      expect(await store.update('t-mart', { category: 'Groceries' })).toBe(true);
      expect(store.rows().find((t) => t.id === 't-mart')?.category).toBe('Groceries');
      expect(api.updateTransaction).toHaveBeenCalledWith('t-mart', { category: 'Groceries' });
      expect(api.summary).toHaveBeenCalledTimes(1);
      expect(seen).toEqual(['ready']);
      expect(store.savingId()).toBeNull();
    });

    it('tells a read-only token how to fix it and leaves the row alone', async () => {
      const { store } = setup({
        updateTransaction: () => Promise.reject(new ApiError(403, 'forbidden', 'Needs full')),
      });
      await store.load();
      expect(await store.update('t-mart', { kind: 'family' })).toBe(false);
      expect(store.saveError()).toBe(
        'This token can only read. Connect with a full-access token to edit transactions.',
      );
      expect(store.rows().find((t) => t.id === 't-mart')?.kind).toBe('spend');
      expect(store.savingId()).toBeNull();
    });

    it('shows the server message for any other failure', async () => {
      const { store } = setup({
        updateTransaction: () =>
          Promise.reject(new ApiError(404, 'not_found', 'No transaction with that id')),
      });
      await store.load();
      expect(await store.update('gone', { kind: 'family' })).toBe(false);
      expect(store.saveError()).toBe('No transaction with that id');
    });
  });
});
