import { TestBed } from '@angular/core/testing';
import { ApiClient, ApiError } from '../api/api-client';
import type { ImportPlanView } from '../api/models';
import { IMPORT_PLAN, PENDING, fakeApi, planFor } from '../../testing-api';
import { must } from '../../testing';
import { ImportStore, LAYOUTS, MAX_CSV_CHARS } from './import-store';

const CSV = 'Date,Narration\n01/10/2026,UPI/CHAI POINT\n';

function setup(over: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({ transactions: () => Promise.resolve(PENDING), ...over });
  TestBed.configureTestingModule({
    providers: [ImportStore, { provide: ApiClient, useValue: api }],
  });
  return { api, store: TestBed.inject(ImportStore) };
}

async function ready(over: Parameters<typeof fakeApi>[0] = {}) {
  const made = setup(over);
  await made.store.loadAccounts();
  made.store.setAccount('acc-bank');
  made.store.setLayout('fakebank-savings');
  made.store.setFile('oct.csv', CSV);
  return made;
}

describe('ImportStore', () => {
  describe('choosing', () => {
    it('lists bank and card accounts but never cash, and the known statement layouts', async () => {
      const { store } = setup();
      await store.loadAccounts();
      expect(store.accountsState()).toBe('ready');
      expect(store.statementAccounts().map((a) => a.name)).toEqual(['HDFC Bank', 'ICICI card']);
      expect(store.layouts).toBe(LAYOUTS);
      expect(LAYOUTS.map((l) => l.id)).toEqual(['fakebank-savings', 'democard']);
    });

    it('says when the accounts cannot be loaded', async () => {
      const { store } = setup({
        balances: () => Promise.reject(new ApiError(0, 'unreachable', 'x')),
      });
      await store.loadAccounts();
      expect(store.accountsState()).toBe('error');
    });

    it('needs an account, a layout and a file before it can preview', async () => {
      const { store } = setup();
      await store.loadAccounts();
      expect(store.canPreview()).toBe(false);
      store.setAccount('acc-bank');
      store.setLayout('fakebank-savings');
      expect(store.canPreview()).toBe(false);
      store.setFile('oct.csv', CSV);
      expect(store.canPreview()).toBe(true);
      expect(store.fileName()).toBe('oct.csv');
    });

    it('refuses an empty file and one that is too large, with a clear message', () => {
      const { store } = setup();
      store.setFile('empty.csv', '  \n ');
      expect([store.fileName(), store.fileError()]).toEqual([null, 'That file is empty.']);
      store.setFile('huge.csv', 'x'.repeat(MAX_CSV_CHARS + 1));
      expect([store.fileName(), store.fileError()]).toEqual([
        null,
        'That file is too large to import.',
      ]);
      store.setFile('ok.csv', CSV);
      expect([store.fileName(), store.fileError()]).toEqual(['ok.csv', null]);
      store.failFile('Could not read that file.');
      expect([store.fileName(), store.fileError()]).toEqual([null, 'Could not read that file.']);
    });
  });

  describe('previewing', () => {
    it('plans with the file, account and layout, and no choices', async () => {
      const { api, store } = await ready();
      await store.preview();
      expect(api.previewImport).toHaveBeenCalledWith({
        accountId: 'acc-bank',
        mappingId: 'fakebank-savings',
        csv: CSV,
      });
      expect(store.step()).toBe('review');
      expect(store.importCount()).toBe(3);
      expect(store.undecided()).toBe(1);
      expect(store.canConfirm()).toBe(true);
      expect(store.busy()).toBeNull();
    });

    it('fetches pending entries once, to show what each choice is', async () => {
      const { api, store } = await ready();
      await store.preview();
      expect(api.transactions).toHaveBeenCalledWith({ status: 'pending', limit: 200 });
      expect(store.entry('t-chai')?.memo).toBe('chai');
      expect(store.candidates(must(store.plan()?.ambiguous[0])).map((c) => c.entry?.memo)).toEqual([
        'bakery',
        'bread and cake',
      ]);
      expect(store.entry('gone')).toBeNull();
      api.transactions.mockClear();
      await store.choose('k-bakery#1', 'new');
      expect(api.transactions).not.toHaveBeenCalled();
    });

    it('does not fetch pending entries when the plan names none', async () => {
      const { api, store } = await ready({
        previewImport: () => Promise.resolve({ ...IMPORT_PLAN, merges: [], ambiguous: [] }),
      });
      await store.preview();
      expect(api.transactions).not.toHaveBeenCalled();
    });

    it('stays on the choose step with the reason when the token is read-only', async () => {
      const { store } = await ready({
        previewImport: () => Promise.reject(new ApiError(403, 'forbidden', 'needs full')),
      });
      await store.preview();
      expect(store.step()).toBe('choose');
      expect(store.error()).toBe(
        'Importing needs a full-access token. Connect with one to import.',
      );
      expect(store.busy()).toBeNull();
    });

    it.each([
      [413, 'That file is too large to import.'],
      [400, 'Unknown layout'],
      [404, 'No account with that id'],
    ])('explains a %i from the server', async (status, expected) => {
      const { store } = await ready({
        previewImport: () => Promise.reject(new ApiError(status, 'x', expected)),
      });
      await store.preview();
      expect(store.error()).toBe(expected);
    });

    it('cannot confirm while a row cannot be read, or when there is nothing to import', async () => {
      const bad = await ready({
        previewImport: () =>
          Promise.resolve({ ...IMPORT_PLAN, issues: [{ line: 7, reason: 'Bad date' }] }),
      });
      await bad.store.preview();
      expect(bad.store.canConfirm()).toBe(false);
    });

    it('cannot confirm an empty import', async () => {
      TestBed.resetTestingModule();
      const { store } = await ready({
        previewImport: () =>
          Promise.resolve({ ...IMPORT_PLAN, toInsert: [], merges: [], ambiguous: [] }),
      });
      await store.preview();
      expect(store.importCount()).toBe(0);
      expect(store.canConfirm()).toBe(false);
    });

    it('cannot start a second preview while one is running', async () => {
      let release: (plan: ImportPlanView) => void = () => undefined;
      const { api, store } = await ready({
        previewImport: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      });
      const first = store.preview();
      expect(store.busy()).toBe('previewing');
      expect(store.canPreview()).toBe(false);
      await store.preview();
      expect(api.previewImport).toHaveBeenCalledTimes(1);
      release(IMPORT_PLAN);
      await first;
      expect(store.step()).toBe('review');
    });

    it('drops an old plan that arrives after a newer decision', async () => {
      let calls = 0;
      let releaseOld: (plan: ImportPlanView) => void = () => undefined;
      const { store } = await ready({
        previewImport: () => {
          calls += 1;
          if (calls === 1) return Promise.resolve(IMPORT_PLAN);
          if (calls === 2) {
            return new Promise((resolve) => {
              releaseOld = resolve;
            });
          }
          return Promise.resolve({ ...IMPORT_PLAN, duplicateCount: 99 });
        },
      });
      await store.preview();
      const older = store.choose('k-bakery#1', 'p-bakery-a');
      await store.choose('k-bakery#1', 'new');
      expect(store.plan()?.duplicateCount).toBe(99);
      expect(store.busy()).toBeNull();
      releaseOld({ ...IMPORT_PLAN, duplicateCount: 1 });
      await older;
      expect(store.plan()?.duplicateCount).toBe(99);
      expect(store.busy()).toBeNull();
    });
  });

  describe('deciding ambiguous rows', () => {
    it('re-plans with the choice, and keeps the row in the picker once it is decided', async () => {
      const { api, store } = await ready({
        previewImport: (request) => Promise.resolve(planFor(request)),
      });
      await store.preview();
      expect(store.decisions().map((d) => d.rowKey)).toEqual(['k-bakery#1']);

      await store.choose('k-bakery#1', 'p-bakery-b');
      expect(api.previewImport).toHaveBeenLastCalledWith(
        expect.objectContaining({ choices: { 'k-bakery#1': 'p-bakery-b' } }),
      );
      expect(store.undecided()).toBe(0);
      expect(store.plan()?.merges.map((m) => m.pendingId)).toEqual(['t-chai', 'p-bakery-b']);
      expect(store.importCount()).toBe(4);
      expect(store.decisions().map((d) => d.rowKey)).toEqual(['k-bakery#1']);
      expect(store.conflicts().size).toBe(0);
    });

    it('lets a decision be changed to "a separate payment"', async () => {
      const { store } = await ready({
        previewImport: (request) => Promise.resolve(planFor(request)),
      });
      await store.preview();
      await store.choose('k-bakery#1', 'p-bakery-a');
      await store.choose('k-bakery#1', 'new');
      expect(store.choices()['k-bakery#1']).toBe('new');
      expect(store.plan()?.toInsert.map((r) => r.rowKey)).toContain('k-bakery#1');
      expect(store.plan()?.merges.map((m) => m.pendingId)).toEqual(['t-chai']);
    });

    it('flags a row whose choice the server could not honour, such as an entry two rows both picked', async () => {
      const { store } = await ready(); // the default plan keeps the row ambiguous whatever is sent
      await store.preview();
      await store.choose('k-bakery#1', 'p-bakery-a');
      expect(store.undecided()).toBe(1);
      expect([...store.conflicts()]).toEqual(['k-bakery#1']);
    });

    it('forgets earlier decisions when a new preview is started', async () => {
      const { store } = await ready({
        previewImport: (request) => Promise.resolve(planFor(request)),
      });
      await store.preview();
      await store.choose('k-bakery#1', 'new');
      await store.preview();
      expect(store.choices()).toEqual({});
      expect(store.undecided()).toBe(1);
    });
  });

  describe('confirming', () => {
    it('sends the same file and choices, shows the outcome and forgets the file', async () => {
      const { api, store } = await ready({
        previewImport: (request) => Promise.resolve(planFor(request)),
      });
      await store.preview();
      await store.choose('k-bakery#1', 'new');
      await store.confirm();
      expect(api.confirmImport).toHaveBeenCalledWith({
        accountId: 'acc-bank',
        mappingId: 'fakebank-savings',
        csv: CSV,
        choices: { 'k-bakery#1': 'new' },
      });
      expect(store.step()).toBe('done');
      expect(store.outcome()?.inserted).toBe(2);
      expect(store.fileName()).toBeNull();
      expect(store.plan()).toBeNull();
      expect(store.canPreview()).toBe(false);
      expect(store.busy()).toBeNull();
    });

    it('does nothing when there is nothing to confirm', async () => {
      const { api, store } = await ready();
      await store.confirm();
      expect(api.confirmImport).not.toHaveBeenCalled();
    });

    it('keeps the review open with the reason when confirming fails', async () => {
      const { store } = await ready({
        confirmImport: () =>
          Promise.reject(new ApiError(0, 'unreachable', 'Could not reach the server')),
      });
      await store.preview();
      await store.confirm();
      expect(store.step()).toBe('review');
      expect(store.error()).toBe('Could not reach the server');
      expect(store.plan()).not.toBeNull();
      expect(store.busy()).toBeNull();
    });
  });

  it('goes back to choosing a file, keeping the account and layout', async () => {
    const { store } = await ready();
    await store.preview();
    store.chooseAnother();
    expect(store.step()).toBe('choose');
    expect(store.plan()).toBeNull();
    expect(store.fileName()).toBeNull();
    expect(store.accountId()).toBe('acc-bank');
    expect(store.mappingId()).toBe('fakebank-savings');
  });
});
