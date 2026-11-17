/**
 * Narrowing helpers for JSON from the API. The server is trusted, but a response is still
 * `unknown` until it is checked: a wrong shape fails here, loudly and by field name, instead of
 * showing a wrong number. Money fields go through `paise()` so a float or an unsafe integer is
 * rejected at the boundary.
 */
import { DateError, MoneyError, parseLocalDate, paise } from '@ledger/core';
import type { LocalDate, Paise } from '@ledger/core';

export class DecodeError extends Error {
  override name = 'DecodeError';
}

const bad = (what: string, expected: string): never => {
  throw new DecodeError(`Unexpected response: ${what} should be ${expected}`);
};

export function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return bad(what, 'an object');
  }
  return value as Record<string, unknown>;
}

export function list(value: unknown, what: string): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : bad(what, 'a list');
}

export function text(value: unknown, what: string): string {
  return typeof value === 'string' ? value : bad(what, 'text');
}

export function int(value: unknown, what: string): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : bad(what, 'a whole number');
}

export function money(value: unknown, what: string): Paise {
  try {
    return paise(int(value, what));
  } catch (error) {
    return error instanceof MoneyError ? bad(what, 'an amount in paise') : rethrow(error);
  }
}

export function day(value: unknown, what: string): LocalDate {
  try {
    return parseLocalDate(text(value, what), 'yyyy-mm-dd');
  } catch (error) {
    return error instanceof DateError ? bad(what, 'a calendar date') : rethrow(error);
  }
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const found = allowed.find((option) => option === value);
  return found ?? bad(what, `one of ${allowed.join(', ')}`);
}

/** `null` and a missing field both read as "none". */
export function nullable<T>(value: unknown, read: (v: unknown) => T): T | null {
  return value === null || value === undefined ? null : read(value);
}

function rethrow(error: unknown): never {
  throw error instanceof Error ? error : new DecodeError('Unexpected response');
}
