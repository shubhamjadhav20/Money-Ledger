/**
 * `LedgerService` over the ledger API. The API is the one place that checks tokens, scopes, rate
 * limits and the audit log; this class only sends requests and checks the shape of the answers.
 * Read calls use the read token; `capture` is the only call that uses the capture token.
 *
 * What is never put in an error or a log: a token, a response body, or any value from the ledger.
 * Error text names the failing field, not its contents.
 */
import {
  LedgerError,
  captureWire,
  forecastWire,
  freeWire,
  potsWire,
  reconcileWire,
  safeText,
  simulateWire,
  summaryWire,
  transactionsWire,
} from '@ledger/tools';
import type { LedgerService } from '@ledger/tools';
import { z } from 'zod';

export interface ApiServiceOptions {
  /** From `loadMcpConfig`: origin only. */
  readonly baseUrl: string;
  readonly readToken: string;
  /** Without it, `capture` fails with `write_disabled` and sends nothing. */
  readonly captureToken?: string | undefined;
  /** Replaceable in tests. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const MAX_BODY_CHARS = 2_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const errorEnvelope = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
const missingAccounts = z.array(z.object({ name: z.string() }));

type Query = Readonly<Record<string, string | number | undefined>>;

export class ApiLedgerService implements LedgerService {
  readonly #baseUrl: string;
  readonly #readToken: string;
  readonly #captureToken: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: ApiServiceOptions) {
    this.#baseUrl = options.baseUrl;
    this.#readToken = options.readToken;
    this.#captureToken = options.captureToken;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async pots() {
    return (await this.#send('GET', '/pots', 'read', potsWire)).items;
  }

  free() {
    return this.#send('GET', '/free', 'read', freeWire);
  }

  async transactions(query: Parameters<LedgerService['transactions']>[0]) {
    return (
      await this.#send('GET', '/transactions', 'read', transactionsWire, { query: { ...query } })
    ).items;
  }

  reconcile(range: { readonly from: string; readonly to: string }) {
    return this.#send('GET', '/reconcile', 'read', reconcileWire, { query: { ...range } });
  }

  forecast(query: Parameters<LedgerService['forecast']>[0]) {
    return this.#send('GET', '/forecast', 'read', forecastWire, { query: { ...query } });
  }

  simulate(query: Parameters<LedgerService['simulate']>[0]) {
    return this.#send('POST', '/simulate', 'read', simulateWire, { json: query });
  }

  summary(month: string) {
    return this.#send('GET', '/summary', 'read', summaryWire, { query: { month } });
  }

  capture(input: Parameters<LedgerService['capture']>[0]) {
    if (this.#captureToken === undefined) {
      return Promise.reject(
        new LedgerError('write_disabled', 'Adding transactions is not switched on for this server'),
      );
    }
    return this.#send('POST', '/capture', 'capture', captureWire, { json: input });
  }

  async #send<S extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    scope: 'read' | 'capture',
    schema: S,
    options: { readonly query?: Query; readonly json?: unknown } = {},
  ): Promise<z.output<S>> {
    const token = scope === 'capture' ? this.#captureToken : this.#readToken;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const suffix = params.size === 0 ? '' : `?${params.toString()}`;

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}${suffix}`, {
        method,
        headers: {
          authorization: `Bearer ${token ?? ''}`,
          accept: 'application/json',
          ...(options.json === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
        // A redirect would carry the bearer token somewhere else.
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new LedgerError(
        timedOut ? 'timeout' : 'unreachable',
        timedOut
          ? 'The ledger API did not answer in time'
          : 'Could not reach the ledger API. Is it running, and is LEDGER_API_URL right?',
      );
    }

    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) {
      throw new LedgerError('response_too_large', 'The ledger API sent more data than expected');
    }
    if (!response.ok) throw failureFor(response.status, text, scope);

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new LedgerError('bad_response', 'The ledger API did not answer with JSON');
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const fields = parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') || '(root)');
      throw new LedgerError(
        'bad_response',
        `The ledger API answered in a shape this server does not understand (at ${fields.join(', ')})`,
      );
    }
    return parsed.data;
  }
}

function failureFor(status: number, text: string, scope: 'read' | 'capture'): LedgerError {
  if (status === 401) {
    return new LedgerError(
      'unauthorized',
      'The ledger API rejected the token: it is wrong, expired or revoked.',
      status,
    );
  }
  if (status === 403) {
    return new LedgerError(
      'forbidden',
      `This token cannot do that: it needs the "${scope}" scope (or full).`,
      status,
    );
  }
  if (status === 429) {
    return new LedgerError(
      'rate_limited',
      'Too many requests. Wait a minute and try again.',
      status,
    );
  }
  let envelope: z.infer<typeof errorEnvelope> | undefined;
  try {
    const parsed = errorEnvelope.safeParse(JSON.parse(text));
    envelope = parsed.success ? parsed.data : undefined;
  } catch {
    envelope = undefined;
  }
  if (envelope === undefined) {
    return new LedgerError(
      `http_${String(status)}`,
      `The ledger API answered with status ${String(status)}`,
      status,
    );
  }
  if (envelope.code === 'missing_balances') {
    const accounts = missingAccounts.safeParse(envelope.details);
    const names = accounts.success ? accounts.data.map((a) => safeText(a.name, 40)).join(', ') : '';
    return new LedgerError(
      'missing_balances',
      `Record a current balance in the app first${names === '' ? '' : `, for: ${names}`}`,
      status,
    );
  }
  return new LedgerError(safeText(envelope.code, 40), safeText(envelope.message, 200), status);
}
