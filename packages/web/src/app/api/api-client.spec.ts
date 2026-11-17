import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { parseLocalDate, paise } from '@ledger/core';
import { must } from '../../testing';
import {
  BALANCES_JSON,
  FORECAST_JSON,
  FREE_JSON,
  IMPORT_OUTCOME_JSON,
  IMPORT_PLAN_JSON,
  MISSING_JSON,
  MOVEMENTS_JSON,
  POTS_JSON,
  SCHEDULED_JSON,
  SUMMARY_JSON,
  TRANSACTIONS_JSON,
} from '../../testing-api';
import { ApiClient, ApiError } from './api-client';
import { AuthStore, authInterceptor } from './auth';

describe('ApiClient', () => {
  let api: ApiClient;
  let backend: HttpTestingController;
  let auth: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(ApiClient);
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthStore);
    auth.connect('tok');
  });

  afterEach(() => {
    backend.verify();
  });

  async function failure(promise: Promise<unknown>): Promise<ApiError> {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }

  it('reads and decodes free-to-spend', async () => {
    const result = api.free();
    const request = backend.expectOne('/api/free');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer tok');
    request.flush(FREE_JSON);
    const free = await result;
    expect(free.kind === 'ready' && free.free.freePaise).toBe(3_250_000);
  });

  it('turns the 409 missing_balances answer into a result, not an error', async () => {
    const result = api.free();
    backend
      .expectOne('/api/free')
      .flush(
        { code: 'missing_balances', message: 'Record balances first', details: MISSING_JSON },
        { status: 409, statusText: 'Conflict' },
      );
    expect(await result).toEqual({
      kind: 'missing-balances',
      accounts: [{ accountId: 'acc-card', name: 'ICICI card' }],
    });
  });

  it('still reports any other 409 as an error', async () => {
    const result = api.free();
    backend
      .expectOne('/api/free')
      .flush({ code: 'conflict', message: 'Nope' }, { status: 409, statusText: 'Conflict' });
    const error = await failure(result);
    expect([error.status, error.code, error.message]).toEqual([409, 'conflict', 'Nope']);
  });

  it('reads the other dashboard endpoints', async () => {
    const forecast = api.forecast();
    backend.expectOne('/api/forecast').flush(FORECAST_JSON);
    expect((await forecast).runwayDays).toBe(27);

    const pots = api.pots();
    backend.expectOne('/api/pots').flush(POTS_JSON);
    expect(await pots).toHaveLength(2);

    const scheduled = api.scheduled();
    backend.expectOne('/api/scheduled').flush(SCHEDULED_JSON);
    expect(await scheduled).toHaveLength(3);

    const balances = api.balances();
    backend.expectOne('/api/balances').flush(BALANCES_JSON);
    expect(await balances).toHaveLength(3);
  });

  it('checks a token with a cheap authenticated read', async () => {
    const result = api.checkToken();
    backend.expectOne('/api/settings').flush({ paydayDay: 7 });
    await expect(result).resolves.toBeUndefined();
  });

  it('records a balance with a POST of exact paise', async () => {
    const result = api.recordBalance('acc-card', paise(-1_200_000));
    const request = backend.expectOne('/api/balances');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ accountId: 'acc-card', amountPaise: -1_200_000 });
    request.flush({ ok: true });
    await expect(result).resolves.toBeUndefined();
  });

  it('signs this tab out when the token is rejected', async () => {
    const result = api.pots();
    backend
      .expectOne('/api/pots')
      .flush(
        { code: 'unauthorized', message: 'Bad token' },
        { status: 401, statusText: 'Unauthorized' },
      );
    const error = await failure(result);
    expect(error.status).toBe(401);
    expect(auth.connected()).toBe(false);
  });

  it('keeps the token on other failures, such as a read-only token trying to write', async () => {
    const result = api.recordBalance('acc-bank', paise(1));
    backend
      .expectOne('/api/balances')
      .flush(
        { code: 'forbidden', message: 'Needs full' },
        { status: 403, statusText: 'Forbidden' },
      );
    expect((await failure(result)).status).toBe(403);
    expect(auth.connected()).toBe(true);
  });

  it('says so when the server cannot be reached', async () => {
    const result = api.pots();
    backend.expectOne('/api/pots').error(new ProgressEvent('error'));
    const error = await failure(result);
    expect([error.status, error.code]).toEqual([0, 'unreachable']);
  });

  it('copes with an error body that is not the API format', async () => {
    const result = api.pots();
    backend
      .expectOne('/api/pots')
      .flush('<html>boom</html>', { status: 500, statusText: 'Server Error' });
    const error = await failure(result);
    expect([error.status, error.code]).toEqual([500, 'http_error']);
  });

  it('refuses a malformed answer instead of showing a wrong number', async () => {
    const result = api.pots();
    backend
      .expectOne('/api/pots')
      .flush({ items: [{ ...must(POTS_JSON.items[0]), balancePaise: 1.5 }] });
    const error = await failure(result);
    expect([error.status, error.code]).toEqual([502, 'bad_response']);
    expect(error.message).toContain('pot.balancePaise');
  });

  describe('transactions', () => {
    const from = parseLocalDate('2026-11-01', 'yyyy-mm-dd');
    const to = parseLocalDate('2026-11-30', 'yyyy-mm-dd');

    it('asks for a date range and a limit, newest first as the server sorts them', async () => {
      const result = api.transactions({ from, to, limit: 200 });
      const request = backend.expectOne((r) => r.url === '/api/transactions');
      expect(request.request.method).toBe('GET');
      expect(request.request.params.get('from')).toBe('2026-11-01');
      expect(request.request.params.get('to')).toBe('2026-11-30');
      expect(request.request.params.get('limit')).toBe('200');
      expect(request.request.params.has('q')).toBe(false);
      expect(request.request.params.has('status')).toBe(false);
      request.flush(TRANSACTIONS_JSON);
      expect(await result).toHaveLength(5);
    });

    it('adds the search text and status only when they are set', async () => {
      const result = api.transactions({
        from,
        to,
        limit: 50,
        search: 'swiggy & co',
        status: 'posted',
      });
      const request = backend.expectOne((r) => r.url === '/api/transactions');
      expect(request.request.params.get('q')).toBe('swiggy & co');
      expect(request.request.params.get('status')).toBe('posted');
      expect(request.request.urlWithParams).toContain('q=swiggy%20%26%20co');
      request.flush({ items: [] });
      expect(await result).toEqual([]);
    });

    it('treats an empty search as no search', async () => {
      const result = api.transactions({ from, to, limit: 50, search: '' });
      const request = backend.expectOne((r) => r.url === '/api/transactions');
      expect(request.request.params.has('q')).toBe(false);
      request.flush({ items: [] });
      await result;
    });
  });

  it('reads the monthly summary', async () => {
    const result = api.summary('2026-11');
    const request = backend.expectOne((r) => r.url === '/api/summary');
    expect(request.request.params.get('month')).toBe('2026-11');
    request.flush(SUMMARY_JSON);
    expect((await result).transferCount).toBe(1);
  });

  describe('updating a transaction', () => {
    it('sends only the fields given, with a PATCH, and decodes the saved row', async () => {
      const result = api.updateTransaction('t-mart', { category: 'Groceries' });
      const request = backend.expectOne('/api/transactions/t-mart');
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ category: 'Groceries' });
      request.flush({ ...must(TRANSACTIONS_JSON.items[2]), category: 'Groceries' });
      expect((await result).category).toBe('Groceries');
    });

    it('can clear a category with null', async () => {
      const result = api.updateTransaction('t-swiggy', { category: null, kind: 'family' });
      const request = backend.expectOne('/api/transactions/t-swiggy');
      expect(request.request.body).toEqual({ category: null, kind: 'family' });
      request.flush({ ...must(TRANSACTIONS_JSON.items[1]), category: null, kind: 'family' });
      expect((await result).kind).toBe('family');
    });

    it('keeps an odd id from changing the URL', async () => {
      const result = api.updateTransaction('a/b?c', { kind: 'spend' });
      const request = backend.expectOne((r) => r.url.startsWith('/api/transactions/'));
      expect(request.request.url).toBe('/api/transactions/a%2Fb%3Fc');
      request.flush({ error: 'x' }, { status: 404, statusText: 'Not Found' });
      expect((await failure(result)).status).toBe(404);
    });
  });

  describe('pots', () => {
    it('creates a pot with a POST and returns its id', async () => {
      const result = api.createPot({ name: 'Rent', kind: 'bill', targetPaise: paise(2_200_000) });
      const request = backend.expectOne('/api/pots');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ name: 'Rent', kind: 'bill', targetPaise: 2_200_000 });
      request.flush({ id: 'pot-9' }, { status: 201, statusText: 'Created' });
      expect(await result).toBe('pot-9');
    });

    it('changes a pot with a PATCH and decodes the pot as it is now', async () => {
      const result = api.updatePot('pot-rent', { targetPaise: null });
      const request = backend.expectOne('/api/pots/pot-rent');
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ targetPaise: null });
      request.flush(must(POTS_JSON.items[1]));
      expect((await result).name).toBe('Rent');
    });

    it('reads a pot journal and adds to it without sending a date', async () => {
      const journal = api.potMovements('pot-buffer');
      backend.expectOne('/api/pots/pot-buffer/movements').flush(MOVEMENTS_JSON);
      expect((await journal).map((m) => m.amountPaise)).toEqual([300_000, -100_000]);

      const added = api.addPotMovement('pot-buffer', {
        amountPaise: paise(-5_000),
        reason: 'spend',
      });
      const request = backend.expectOne('/api/pots/pot-buffer/movements');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ amountPaise: -5_000, reason: 'spend' });
      request.flush({ id: 'm-3' }, { status: 201, statusText: 'Created' });
      await added;
    });

    it('keeps an odd pot id from changing the URL', async () => {
      const result = api.potMovements('a/b?c');
      backend.expectOne('/api/pots/a%2Fb%3Fc/movements').flush({ items: [] });
      expect(await result).toEqual([]);
    });

    it('says when a read-only token tries to change a pot', async () => {
      const result = failure(api.createPot({ name: 'x', kind: 'buffer' }));
      backend
        .expectOne('/api/pots')
        .flush(
          { error: { code: 'forbidden', message: 'This token cannot do that' } },
          { status: 403, statusText: 'Forbidden' },
        );
      const error = await result;
      expect(error.status).toBe(403);
      expect(auth.connected()).toBe(true);
    });
  });

  describe('importing', () => {
    const request = { accountId: 'acc-bank', mappingId: 'fakebank-savings', csv: 'a,b\n1,2' };

    it('previews with a POST of the file, account, layout and no choices', async () => {
      const result = api.previewImport(request);
      const call = backend.expectOne('/api/imports');
      expect(call.request.method).toBe('POST');
      expect(call.request.body).toEqual(request);
      call.flush(IMPORT_PLAN_JSON);
      expect((await result).ambiguous).toHaveLength(1);
    });

    it('sends the choices when there are any', async () => {
      const result = api.previewImport({ ...request, choices: { 'k-bakery#1': 'p-bakery-a' } });
      const call = backend.expectOne('/api/imports');
      expect(call.request.body).toEqual({ ...request, choices: { 'k-bakery#1': 'p-bakery-a' } });
      call.flush(IMPORT_PLAN_JSON);
      await result;
    });

    it('confirms with a POST to the confirm endpoint', async () => {
      const result = api.confirmImport(request);
      const call = backend.expectOne('/api/imports/confirm');
      expect(call.request.method).toBe('POST');
      call.flush(IMPORT_OUTCOME_JSON);
      expect((await result).inserted).toBe(2);
    });

    it('reports rows that could not be read on confirm as an error carrying the details', async () => {
      const result = api.confirmImport(request);
      backend.expectOne('/api/imports/confirm').flush(
        {
          code: 'parse_issues',
          message: 'The file has rows that could not be read; nothing was imported',
          details: [{ line: 7, reason: 'Bad date' }],
        },
        { status: 422, statusText: 'Unprocessable' },
      );
      const error = await failure(result);
      expect([error.status, error.code]).toEqual([422, 'parse_issues']);
    });

    it('says when a read-only token tries to import', async () => {
      const result = api.previewImport(request);
      backend
        .expectOne('/api/imports')
        .flush(
          { code: 'forbidden', message: 'needs full' },
          { status: 403, statusText: 'Forbidden' },
        );
      expect((await failure(result)).status).toBe(403);
      expect(auth.connected()).toBe(true);
    });
  });

  it('asks for pending entries across all dates when no range is given', async () => {
    const result = api.transactions({ status: 'pending', limit: 200 });
    const call = backend.expectOne((r) => r.url === '/api/transactions');
    expect(call.request.params.get('status')).toBe('pending');
    expect(call.request.params.has('from')).toBe(false);
    expect(call.request.params.has('to')).toBe(false);
    call.flush({ items: [] });
    await result;
  });
});
