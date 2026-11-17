import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_PREFIX, AuthStore } from './auth';
import { DecodeError, record } from './decode';
import {
  decodeBalances,
  decodeForecast,
  decodeFree,
  decodeImportOutcome,
  decodeImportPlan,
  decodeMissing,
  decodeCreatedId,
  decodePot,
  decodePotMovements,
  decodePots,
  decodeScheduled,
  decodeSummary,
  decodeTransaction,
  decodeTransactions,
} from './models';
import type {
  AccountBalanceView,
  ForecastView,
  FreeView,
  ImportOutcomeView,
  ImportPlanView,
  MissingAccount,
  PotMovementView,
  PotView,
  ScheduledView,
  SummaryView,
  TransactionView,
  TxStatus,
} from './models';
import type { LocalDate, Paise, TxKind } from '@ledger/core';

/** A failed API call, in the API's own `{ code, message }` terms. `status` 0 means unreachable. */
export class ApiError extends Error {
  override name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface TransactionQuery {
  readonly from?: LocalDate;
  readonly to?: LocalDate;
  readonly search?: string;
  readonly status?: TxStatus;
  readonly limit: number;
}

/** A new pot. Only bill pots may have a due date or cover a card. */
export interface PotInput {
  readonly name: string;
  readonly kind: PotView['kind'];
  readonly targetPaise?: Paise;
  readonly dueDate?: LocalDate;
  readonly coversCardAccountId?: string;
}

/** What may change on a pot. `null` clears the target or the due date. */
export interface PotChange {
  readonly name?: string;
  readonly targetPaise?: Paise | null;
  readonly dueDate?: LocalDate | null;
}

/**
 * Money into (positive) or out of (negative) a pot. The date is left to the server, which uses
 * today in India, so the page never needs its own clock for this.
 */
export interface PotMovementInput {
  readonly amountPaise: Paise;
  readonly reason: 'spend' | 'trueup' | 'manual';
}

/** Only what the API allows to change on an existing transaction. `null` clears the category. */
export interface TransactionChange {
  readonly category?: string | null;
  readonly kind?: TxKind;
}

/** One uploaded statement. `choices` maps a row key to the pending entry it is, or `'new'`. */
export interface ImportRequest {
  readonly accountId: string;
  readonly mappingId: string;
  readonly csv: string;
  readonly choices?: Readonly<Record<string, string>>;
}

export type FreeResult =
  | { readonly kind: 'ready'; readonly free: FreeView }
  | { readonly kind: 'missing-balances'; readonly accounts: readonly MissingAccount[] };

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return new ApiError(0, 'unreachable', 'Could not reach the server');
    }
    const body: unknown = error.error;
    if (typeof body === 'object' && body !== null && 'code' in body && 'message' in body) {
      const { code, message } = body;
      const details = 'details' in body ? body.details : undefined;
      if (typeof code === 'string' && typeof message === 'string') {
        return new ApiError(error.status, code, message, details);
      }
    }
    return new ApiError(error.status, 'http_error', `The server answered ${String(error.status)}`);
  }
  if (error instanceof DecodeError) return new ApiError(502, 'bad_response', error.message);
  return new ApiError(0, 'unknown', 'Something went wrong');
}

/**
 * Typed access to the API. Every answer is decoded before it is returned, a 401 signs this tab out
 * (the token is no good), and errors always come out as `ApiError`.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    decode: (body: unknown) => T,
    options: { body?: unknown; params?: Record<string, string | number> } = {},
  ): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.http.request<unknown>(method, `${API_PREFIX}${path}`, {
          ...(options.body === undefined ? {} : { body: options.body }),
          ...(options.params === undefined ? {} : { params: options.params }),
        }),
      );
      return decode(response);
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.status === 401) this.auth.disconnect();
      throw apiError;
    }
  }

  /** Cheapest authenticated read: proves the token works. */
  async checkToken(): Promise<void> {
    await this.request('GET', '/settings', (body) => record(body, 'settings'));
  }

  async free(): Promise<FreeResult> {
    try {
      return { kind: 'ready', free: await this.request('GET', '/free', decodeFree) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === 'missing_balances') {
        return { kind: 'missing-balances', accounts: decodeMissing(error.details) };
      }
      throw error;
    }
  }

  forecast(): Promise<ForecastView> {
    return this.request('GET', '/forecast', decodeForecast);
  }

  pots(): Promise<PotView[]> {
    return this.request('GET', '/pots', decodePots);
  }

  /** Needs a full-access token. Returns the new pot's id. */
  createPot(input: PotInput): Promise<string> {
    return this.request('POST', '/pots', decodeCreatedId, { body: input });
  }

  /** Needs a full-access token. Returns the pot as it is now. */
  updatePot(id: string, change: PotChange): Promise<PotView> {
    return this.request('PATCH', `/pots/${encodeURIComponent(id)}`, decodePot, { body: change });
  }

  /** A pot's journal, oldest first. */
  potMovements(id: string): Promise<PotMovementView[]> {
    return this.request('GET', `/pots/${encodeURIComponent(id)}/movements`, decodePotMovements);
  }

  /** Needs a full-access token. The journal is append-only: a mistake is fixed by another entry. */
  async addPotMovement(id: string, input: PotMovementInput): Promise<void> {
    await this.request('POST', `/pots/${encodeURIComponent(id)}/movements`, decodeCreatedId, {
      body: input,
    });
  }

  scheduled(): Promise<ScheduledView[]> {
    return this.request('GET', '/scheduled', decodeScheduled);
  }

  balances(): Promise<AccountBalanceView[]> {
    return this.request('GET', '/balances', decodeBalances);
  }

  /** Needs a full-access token. Cards owed money are negative. */
  async recordBalance(accountId: string, amountPaise: Paise): Promise<void> {
    await this.request('POST', '/balances', (reply) => record(reply, 'balance reply'), {
      body: { accountId, amountPaise },
    });
  }

  /** Newest first, at most `limit` rows. Reads only. */
  transactions(query: TransactionQuery): Promise<TransactionView[]> {
    return this.request('GET', '/transactions', decodeTransactions, {
      params: {
        limit: query.limit,
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
        ...(query.search === undefined || query.search === '' ? {} : { q: query.search }),
        ...(query.status === undefined ? {} : { status: query.status }),
      },
    });
  }

  /** Where the month's money went. `month` is `YYYY-MM`. */
  summary(month: string): Promise<SummaryView> {
    return this.request('GET', '/summary', decodeSummary, { params: { month } });
  }

  /** Needs a full-access token. Changes the category and/or kind, nothing else. */
  updateTransaction(id: string, change: TransactionChange): Promise<TransactionView> {
    return this.request('PATCH', `/transactions/${encodeURIComponent(id)}`, decodeTransaction, {
      body: change,
    });
  }

  /** What importing would do, with no changes made. Needs a full-access token. */
  previewImport(request: ImportRequest): Promise<ImportPlanView> {
    return this.request('POST', '/imports', decodeImportPlan, { body: request });
  }

  /** Imports for real. The server re-plans from the same file and choices, so nothing counts twice. */
  confirmImport(request: ImportRequest): Promise<ImportOutcomeView> {
    return this.request('POST', '/imports/confirm', decodeImportOutcome, { body: request });
  }
}
