import { describe, expect, it } from 'vitest';
import { LedgerError } from '@ledger/tools';
import { ApiLedgerService } from './api-service.ts';

const READ = 'led_read_token_for_tests';
const CAPTURE = 'led_capture_token_for_tests';

const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

interface Seen {
  url: string;
  method: string;
  authorization: string | null;
  body: string | undefined;
  redirect: string | undefined;
}

function stub(reply: () => Response | Promise<Response> | never) {
  const seen: Seen[] = [];
  const fakeFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: urlOf(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization'),
      body: typeof init?.body === 'string' ? init.body : undefined,
      redirect: init?.redirect,
    });
    return Promise.resolve(reply());
  };
  const service = new ApiLedgerService({
    baseUrl: 'http://127.0.0.1:3000',
    readToken: READ,
    captureToken: CAPTURE,
    fetch: fakeFetch,
  });
  return { service, seen };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const failure = async (promise: Promise<unknown>): Promise<LedgerError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerError);
    return error as LedgerError;
  }
  throw new Error('expected a failure');
};

describe('requests', () => {
  it('sends GETs with the read token, drops undefined query values and refuses redirects', async () => {
    const { service, seen } = stub(() => json({ items: [] }));
    await service.transactions({ limit: 20, from: '2026-11-01', q: 'cafe & co' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: 'GET',
      authorization: `Bearer ${READ}`,
      redirect: 'error',
      body: undefined,
    });
    expect(seen[0]?.url).toBe(
      'http://127.0.0.1:3000/transactions?limit=20&from=2026-11-01&q=cafe+%26+co',
    );
  });

  it('posts the simulation with the read token', async () => {
    const { service, seen } = stub(() =>
      json({
        method: 'upi',
        affordableNow: true,
        freeAfterPaise: 100,
        installments: [],
        warnings: [],
        assumptions: [],
      }),
    );
    await service.simulate({ amountPaise: 230_000, method: 'upi' });
    expect(seen[0]).toMatchObject({ method: 'POST', authorization: `Bearer ${READ}` });
    expect(seen[0]?.url).toBe('http://127.0.0.1:3000/simulate');
    expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({ amountPaise: 230_000, method: 'upi' });
  });

  it('uses the capture token for capture and for nothing else', async () => {
    const { service, seen } = stub(() =>
      json(
        {
          id: 'c1',
          entry: {
            date: '2026-11-17',
            amountPaise: -45_000,
            method: 'upi',
            category: 'dinner',
            kind: 'spend',
            memo: '',
            status: 'pending',
          },
        },
        201,
      ),
    );
    await service.capture({ text: 'spent 450 on dinner' });
    expect(seen[0]?.authorization).toBe(`Bearer ${CAPTURE}`);
    expect(seen[0]?.url).toBe('http://127.0.0.1:3000/capture');
  });

  it('does not send capture at all without a capture token', async () => {
    const seen: string[] = [];
    const service = new ApiLedgerService({
      baseUrl: 'http://127.0.0.1:3000',
      readToken: READ,
      fetch: (input) => {
        seen.push(urlOf(input));
        return Promise.resolve(json({}));
      },
    });
    const error = await failure(service.capture({ text: 'spent 1 on tea' }));
    expect(error.code).toBe('write_disabled');
    expect(seen).toEqual([]);
  });
});

describe('answers', () => {
  it('drops fields it does not know and returns the typed rows', async () => {
    const { service } = stub(() =>
      json({
        items: [
          {
            id: 'pot-1',
            name: 'Rent',
            kind: 'bill',
            balancePaise: 5,
            targetPaise: null,
            dueDate: null,
            future: 'ignored',
          },
        ],
      }),
    );
    expect(await service.pots()).toEqual([
      {
        id: 'pot-1',
        name: 'Rent',
        kind: 'bill',
        balancePaise: 5,
        targetPaise: null,
        dueDate: null,
      },
    ]);
  });

  it('accepts pots whose target and due date keys are left out, as the API does', async () => {
    const { service } = stub(() =>
      json({ items: [{ id: 'pot-1', name: 'Trip', kind: 'spend', balancePaise: 5 }] }),
    );
    expect(await service.pots()).toEqual([
      { id: 'pot-1', name: 'Trip', kind: 'spend', balancePaise: 5 },
    ]);
  });

  it('names the wrong field but never echoes its value', async () => {
    const secretLooking = 'memo-with-private-text';
    const { service } = stub(() =>
      json({ items: [{ id: 'pot-1', name: secretLooking, kind: 'bill', balancePaise: 'lots' }] }),
    );
    const error = await failure(service.pots());
    expect(error.code).toBe('bad_response');
    expect(error.message).toContain('items.0.balancePaise');
    expect(error.message).not.toContain(secretLooking);
    expect(error.message).not.toContain('lots');
  });

  it('rejects a non-JSON body and an oversized body', async () => {
    expect((await failure(stub(() => new Response('<html>')).service.pots())).code).toBe(
      'bad_response',
    );
    const big = new Response('x'.repeat(2_000_001));
    expect((await failure(stub(() => big).service.pots())).code).toBe('response_too_large');
  });
});

describe('failures', () => {
  it.each([
    [401, 'unauthorized', 'wrong, expired or revoked'],
    [403, 'forbidden', 'needs the "read" scope'],
    [429, 'rate_limited', 'Wait a minute'],
  ])('maps status %i to %s', async (status, code, text) => {
    const error = await failure(
      stub(() => json({ code: 'x', message: 'ignored' }, status)).service.pots(),
    );
    expect(error).toMatchObject({ code, status });
    expect(error.message).toContain(text);
  });

  it('asks for the capture scope when capture is refused', async () => {
    const error = await failure(
      stub(() => json({ code: 'forbidden', message: 'no' }, 403)).service.capture({
        text: 'spent 1 on tea',
      }),
    );
    expect(error.message).toContain('needs the "capture" scope');
  });

  it('turns missing balances into a message that names the accounts', async () => {
    const reply = () =>
      json(
        {
          code: 'missing_balances',
          message: 'Record a current balance for every account first (POST /balances)',
          details: [
            { accountId: 'a', name: 'Demo Card' },
            { accountId: 'b', name: 'Cash' },
          ],
        },
        409,
      );
    const error = await failure(stub(reply).service.free());
    expect(error).toMatchObject({ code: 'missing_balances', status: 409 });
    expect(error.message).toBe('Record a current balance in the app first, for: Demo Card, Cash');
  });

  it('passes the API envelope through, cleaned and capped', async () => {
    const noisy = `bad\n${'x'.repeat(400)}`;
    const error = await failure(
      stub(() => json({ code: 'invalid_capture', message: noisy }, 422)).service.capture({
        text: 'zzz',
      }),
    );
    expect(error.code).toBe('invalid_capture');
    expect(Array.from(error.message)).toHaveLength(200);
    expect(error.message).not.toContain('\n');
  });

  it('falls back to the status when the body is not an envelope', async () => {
    const error = await failure(stub(() => new Response('boom', { status: 500 })).service.pots());
    expect(error).toMatchObject({ code: 'http_500', status: 500 });
  });

  it('reports an unreachable API and a timeout without echoing the cause', async () => {
    const refused = new ApiLedgerService({
      baseUrl: 'http://127.0.0.1:1',
      readToken: READ,
      fetch: () => Promise.reject(new TypeError(`connect ECONNREFUSED with ${READ}`)),
    });
    const unreachable = await failure(refused.pots());
    expect(unreachable.code).toBe('unreachable');
    expect(unreachable.message).not.toContain(READ);

    const slow = new ApiLedgerService({
      baseUrl: 'http://127.0.0.1:1',
      readToken: READ,
      fetch: () => Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    });
    expect((await failure(slow.pots())).code).toBe('timeout');
  });

  it('never puts a token in any error', async () => {
    for (const status of [401, 403, 429]) {
      const error = await failure(
        stub(() => json({ code: 'c', message: `m ${READ}` }, status)).service.pots(),
      );
      expect(error.message).not.toContain(READ);
    }
  });
});
