/**
 * Percentages without floating point: "12.5" is read as 1250 basis points (1/100 of a percent),
 * which is what the API stores. Only plain numbers are accepted (up to two decimals, 0 to 100),
 * with an optional trailing "%".
 */
export function parsePercent(raw: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(raw.trim().replace(/\s*%$/, ''));
  if (match === null) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = whole * 100 + fraction;
  return basisPoints <= 10_000 ? basisPoints : null;
}

/** 1250 becomes "12.5", 2000 becomes "20": the form the person would type back. */
export function plainPercent(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = basisPoints % 100;
  if (fraction === 0) return String(whole);
  return `${String(whole)}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}
