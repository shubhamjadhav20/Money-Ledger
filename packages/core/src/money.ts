/**
 * Money is integer paise. Never floats: amounts are parsed from strings digit by digit and
 * formatted from integer parts, so no value ever passes through a fractional number.
 */

declare const paiseBrand: unique symbol;
export type Paise = number & { readonly [paiseBrand]: 'paise' };

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export function paise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Not a safe integer paise amount: ${String(value)}`);
  }
  return value as Paise;
}

export const ZERO_PAISE = paise(0);

export const addPaise = (a: Paise, b: Paise): Paise => paise(a + b);
export const subPaise = (a: Paise, b: Paise): Paise => paise(a - b);
export const negatePaise = (a: Paise): Paise => paise(a === 0 ? 0 : 0 - a); // avoids -0
export const absPaise = (a: Paise): Paise => paise(Math.abs(a));

export function sumPaise(amounts: Iterable<Paise>): Paise {
  let total = ZERO_PAISE;
  for (const amount of amounts) total = addPaise(total, amount);
  return total;
}

// Integer part: plain digits, Indian grouping (12,34,567) or western grouping (123,456).
const AMOUNT_PATTERN =
  /^(?<int>\d+|\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.(?<frac>\d{1,2}))?$/;
const CURRENCY_PREFIX = /^(?:₹|rs\.?|inr)\s*/i;

/**
 * Parse a human/bank amount string into paise.
 * Accepts: optional sign or accounting parentheses, optional ₹/Rs/INR, Indian or western digit
 * grouping, up to 2 decimals. Anything else throws: an import must never guess at an amount.
 */
export function parseAmount(input: string): Paise {
  let text = input.trim();
  let negative = false;

  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1).trim();
  } else if (text.startsWith('-') || text.startsWith('+')) {
    negative = text.startsWith('-');
    text = text.slice(1).trim();
  }
  text = text.replace(CURRENCY_PREFIX, '');

  const match = AMOUNT_PATTERN.exec(text);
  const intPart = match?.groups?.['int'];
  if (intPart === undefined) {
    throw new MoneyError(`Not a valid amount: ${JSON.stringify(input)}`);
  }
  const fracPart = (match?.groups?.['frac'] ?? '').padEnd(2, '0');

  const rupees = Number(intPart.replaceAll(',', ''));
  if (!Number.isSafeInteger(rupees * 100)) {
    throw new MoneyError(`Amount too large: ${JSON.stringify(input)}`);
  }
  const value = rupees * 100 + Number(fracPart);
  return paise(negative ? -value : value);
}

const rupeeFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Format paise as Indian rupees, e.g. 12345678 -> "₹1,23,456.78", -500 -> "-₹5.00". */
export function formatINR(amount: Paise): string {
  const abs = Math.abs(amount);
  const paisePart = abs % 100;
  const rupees = (abs - paisePart) / 100; // exact: abs - paisePart is a multiple of 100
  const sign = amount < 0 ? '-' : '';
  return `${sign}₹${rupeeFormatter.format(rupees)}.${String(paisePart).padStart(2, '0')}`;
}
