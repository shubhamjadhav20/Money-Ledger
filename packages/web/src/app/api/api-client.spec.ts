import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { paise } from '@ledger/core';
import { must } from '../../testing';
import {
  BALANCES_JSON,
  FORECAST_JSON,
  FREE_JSON,
  MISSING_JSON,
  POTS_JSON,
  SCHEDULED_JSON,
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
});
