/**
 * Quick-add grammar for the PWA and the Telegram bot: "20 food upi" -> a pending manual entry.
 * Pure, deterministic, no LLM. The input is untrusted text (chat message or form field): it is
 * length-capped, tokenised by whitespace (no regex over the whole input), and never throws.
 *
 *   [spent|paid|got|received] [+|-]<amount> [on|for|at|to|from|in] <category> [memo words...]
 *   plus, anywhere: a method (upi|card|cc|cash|netbanking|nb) and a date (today|yesterday|YYYY-MM-DD)
 *
 * The first non-keyword word is the category; the rest is the memo. Which account the entry lands
 * in is decided by the API from `method`, not here.
 */
import { addDays, parseLocalDate } from './dates.ts';
import type { LocalDate } from './dates.ts';
import type { PaymentMethod } from './domain.ts';
import { negatePaise, parseAmount } from './money.ts';
import type { Paise } from './money.ts';

export const MAX_CAPTURE_LENGTH = 200;
export const MAX_MEMO_LENGTH = 80;

export interface CaptureContext {
  readonly today: LocalDate;
  /** Method when none is typed. Default 'upi'. */
  readonly defaultMethod?: PaymentMethod;
}

export interface CapturedEntry {
  readonly date: LocalDate;
  /** Negative = spend, positive = income. */
  readonly amount: Paise;
  readonly method: PaymentMethod;
  readonly category: string;
  readonly memo: string;
  readonly kind: 'spend' | 'income';
  readonly source: 'manual';
  readonly status: 'pending';
}

export type CaptureResult =
  | { readonly ok: true; readonly entry: CapturedEntry }
  | { readonly ok: false; readonly error: string };

const METHODS: Readonly<Record<string, PaymentMethod>> = {
  upi: 'upi',
  card: 'card',
  cc: 'card',
  cash: 'cash',
  netbanking: 'netbanking',
  nb: 'netbanking',
};
const FILLER = new Set(['on', 'for', 'at', 'to', 'from', 'in']);
const SPEND_VERBS = new Set(['spent', 'paid']);
const INCOME_VERBS = new Set(['got', 'received']);
const CATEGORY = /^[a-z][a-z0-9_-]{0,31}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/gu;

const fail = (error: string): CaptureResult => ({ ok: false, error });

export function parseCapture(text: string, context: CaptureContext): CaptureResult {
  if (text.length > MAX_CAPTURE_LENGTH) {
    return fail(`Message too long (max ${String(MAX_CAPTURE_LENGTH)} characters)`);
  }
  const tokens = text.split(/\s+/u).filter((t) => t !== '');
  if (tokens.length === 0) return fail('Empty message: try "20 food upi"');

  let income = false;
  let amount: Paise | undefined;
  let method: PaymentMethod | undefined;
  let date: LocalDate | undefined;
  const words: string[] = [];

  for (const [index, raw] of tokens.entries()) {
    const token = raw.toLowerCase();
    if (index === 0 && SPEND_VERBS.has(token)) continue;
    if (index === 0 && INCOME_VERBS.has(token)) {
      income = true;
      continue;
    }

    if (amount === undefined && words.length === 0 && /^[+-]?(?:₹|rs\.?|inr)?\d/iu.test(raw)) {
      const sign = raw.startsWith('+') ? '+' : raw.startsWith('-') ? '-' : '';
      if (sign === '+') income = true;
      try {
        amount = parseAmount(sign === '' ? raw : raw.slice(1));
      } catch {
        return fail(`Not a valid amount: ${JSON.stringify(raw.slice(0, 20))}`);
      }
      if (amount === 0) return fail('Amount cannot be zero');
      continue;
    }

    const parsedMethod = METHODS[token];
    if (parsedMethod !== undefined) {
      if (method !== undefined && method !== parsedMethod) {
        return fail('Two payment methods given: use only one of upi, card, cash, netbanking');
      }
      method = parsedMethod;
      continue;
    }

    const parsedDate = parseDateToken(token, context.today);
    if (parsedDate !== undefined) {
      if (parsedDate === 'invalid') return fail(`Not a valid date: ${JSON.stringify(token)}`);
      if (date !== undefined && date !== parsedDate) return fail('Two different dates given');
      date = parsedDate;
      continue;
    }

    if (FILLER.has(token) && words.length <= 1) continue;
    words.push(raw);
  }

  if (amount === undefined) return fail('Missing amount: start with a number, e.g. "20 food upi"');
  const [first, ...rest] = words;
  if (first === undefined) return fail('Missing category: e.g. "20 food upi"');
  const category = first.toLowerCase();
  if (!CATEGORY.test(category)) {
    return fail('Category must start with a letter and use only letters, digits, - or _');
  }

  const memo = rest.join(' ').replace(CONTROL_CHARS, '').slice(0, MAX_MEMO_LENGTH).trim();
  return {
    ok: true,
    entry: {
      date: date ?? context.today,
      amount: income ? amount : negatePaise(amount),
      method: method ?? context.defaultMethod ?? 'upi',
      category,
      memo,
      kind: income ? 'income' : 'spend',
      source: 'manual',
      status: 'pending',
    },
  };
}

function parseDateToken(token: string, today: LocalDate): LocalDate | 'invalid' | undefined {
  if (token === 'today') return today;
  if (token === 'yesterday') return addDays(today, -1);
  if (!ISO_DATE.test(token)) return undefined;
  try {
    return parseLocalDate(token, 'yyyy-mm-dd');
  } catch {
    return 'invalid';
  }
}
