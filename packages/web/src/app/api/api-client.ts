import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_PREFIX, AuthStore } from './auth';
import { DecodeError, record } from './decode';
import {
  decodeBalances,
  decodeForecast,
  decodeFree,
  decodeMissing,
  decodePots,
  decodeScheduled,
} from './models';
import type {
  AccountBalanceView,
  ForecastView,
  FreeView,
  MissingAccount,
  PotView,
  ScheduledView,
} from './models';
import type { Paise } from '@ledger/core';

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
    method: 'GET' | 'POST',
    path: string,
    decode: (body: unknown) => T,
    body?: unknown,
  ): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.http.request<unknown>(method, `${API_PREFIX}${path}`, {
          ...(body === undefined ? {} : { body }),
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

  scheduled(): Promise<ScheduledView[]> {
    return this.request('GET', '/scheduled', decodeScheduled);
  }

  balances(): Promise<AccountBalanceView[]> {
    return this.request('GET', '/balances', decodeBalances);
  }

  /** Needs a full-access token. Cards owed money are negative. */
  async recordBalance(accountId: string, amountPaise: Paise): Promise<void> {
    await this.request('POST', '/balances', (reply) => record(reply, 'balance reply'), {
      accountId,
      amountPaise,
    });
  }
}
