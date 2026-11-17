/**
 * Small helpers shared by every route module: structured errors and strict request parsing.
 * Validation problems report the path and rule only; submitted values are never echoed back.
 */
import { z } from 'zod';
import { parseLocalDate } from '@ledger/core';

export class HttpError extends Error {
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

export const fail = (status: number, code: string, message: string, details?: unknown): never => {
  throw new HttpError(status, code, message, details);
};

export function parseWith<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  return fail(
    400,
    'invalid_request',
    'Request did not match the expected shape',
    result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

export const idText = z.string().min(1).max(64);

/** `YYYY-MM-DD`, rejecting impossible dates such as 2026-02-30. Yields a `LocalDate`. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .transform((text, ctx) => {
    try {
      return parseLocalDate(text, 'yyyy-mm-dd');
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Not a real calendar date' });
      return z.NEVER;
    }
  });

/** A whole number of paise, as a plain JSON number within the safe-integer range. */
export const paiseInt = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
