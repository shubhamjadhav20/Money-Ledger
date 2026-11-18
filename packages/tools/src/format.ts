/**
 * Output helpers shared by every tool: amounts are always `{ paise, formatted }`, and any text
 * that came from the ledger (names, categories, memos, counterparties) is cleaned and capped.
 */
import { formatINR, paise } from '@ledger/core';
import { z } from 'zod';

export const moneySchema = z.object({
  paise: z.number().int().describe('Integer paise (100 paise = ₹1). Negative = money out.'),
  formatted: z.string().describe('The same amount as Indian rupees, e.g. ₹1,234.50 or -₹45.00'),
});
export type Money = z.infer<typeof moneySchema>;

export function moneyOf(amountPaise: number): Money {
  return { paise: amountPaise, formatted: formatINR(paise(amountPaise)) };
}

// Control characters, invisible format characters (zero-width, bidi overrides) and line or
// paragraph separators. All become a space so a memo can never hide or reorder text.
const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export const DEFAULT_TEXT_LIMIT = 80;

/**
 * Cleans text that came from the ledger. It is data, never an instruction: control and invisible
 * characters become spaces, runs of whitespace collapse, and the result is capped by code points.
 */
export function safeText(text: string, limit: number = DEFAULT_TEXT_LIMIT): string {
  const cleaned = text.replace(UNSAFE_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim();
  const characters = Array.from(cleaned);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : cleaned;
}
