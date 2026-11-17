/**
 * Payday waterfall: split a salary across ordered rules. PLAN.md rule 4.
 *
 * - `fixed` asks for an exact amount; `percent` asks for basis points (1/100 of a percent) of
 *   the GROSS payday amount; `remainder` (at most one, last) takes whatever is left.
 * - Rules are applied in order. Each gets min(requested, remaining); any gap is a shortfall.
 * - Percent shares are rounded by largest remainder, so shares that add up to 100% use every
 *   paisa. Rounding is done in BigInt so large amounts can't lose precision.
 * Invariant (property-tested): sum(allocated) + unallocated === payday amount.
 */
import { paise } from './money.ts';
import type { Paise } from './money.ts';

interface RuleBase {
  readonly name: string;
  /** Pot that receives the allocation, if any. */
  readonly potId?: string;
}

export type PaydayRule = RuleBase &
  (
    | { readonly kind: 'fixed'; readonly amountPaise: number }
    | { readonly kind: 'percent'; readonly basisPoints: number }
    | { readonly kind: 'remainder' }
  );

export interface Allocation {
  readonly name: string;
  readonly potId?: string;
  readonly kind: PaydayRule['kind'];
  readonly requestedPaise: Paise;
  readonly allocatedPaise: Paise;
  readonly shortfallPaise: Paise;
}

export interface PaydayResult {
  readonly allocations: Allocation[];
  /** Money no rule claimed (only possible without a remainder rule). */
  readonly unallocatedPaise: Paise;
}

export class PaydayError extends Error {
  override name = 'PaydayError';
}

export function validatePaydayRules(rules: readonly PaydayRule[]): string[] {
  const errors: string[] = [];
  let totalBps = 0;
  rules.forEach((rule, index) => {
    if (
      rule.kind === 'fixed' &&
      (!Number.isSafeInteger(rule.amountPaise) || rule.amountPaise < 0)
    ) {
      errors.push(`${rule.name}: fixed amount must be a non-negative whole number of paise`);
    }
    if (rule.kind === 'percent') {
      if (
        !Number.isInteger(rule.basisPoints) ||
        rule.basisPoints < 0 ||
        rule.basisPoints > 10_000
      ) {
        errors.push(`${rule.name}: percent must be 0..10000 basis points`);
      }
      totalBps += rule.basisPoints;
    }
    if (rule.kind === 'remainder' && index !== rules.length - 1) {
      errors.push(`${rule.name}: the remainder rule must be the last rule`);
    }
  });
  if (totalBps > 10_000) errors.push('Percent rules add up to more than 100%');
  if (rules.filter((r) => r.kind === 'remainder').length > 1)
    errors.push('Only one remainder rule is allowed');
  return errors;
}

/** Largest-remainder split of basis-point shares of `amount`. */
function percentShares(amount: Paise, rules: readonly PaydayRule[]): Map<number, number> {
  const big = BigInt(amount);
  const entries = rules.flatMap((rule, index) =>
    rule.kind === 'percent' ? [{ index, numerator: big * BigInt(rule.basisPoints) }] : [],
  );
  const totalBps = entries.reduce((s, e) => s + e.numerator, 0n);
  const target = totalBps / 10_000n;

  const shares = entries.map((e) => ({
    ...e,
    floor: e.numerator / 10_000n,
    fraction: e.numerator % 10_000n,
  }));
  let leftover = target - shares.reduce((s, e) => s + e.floor, 0n);
  const byFraction = [...shares].sort((a, b) =>
    a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1,
  );
  const result = new Map(shares.map((s) => [s.index, s.floor]));
  for (const s of byFraction) {
    if (leftover === 0n) break;
    result.set(s.index, (result.get(s.index) ?? 0n) + 1n);
    leftover -= 1n;
  }
  return new Map([...result].map(([index, value]) => [index, Number(value)]));
}

export function applyPayday(amount: Paise, rules: readonly PaydayRule[]): PaydayResult {
  if (amount < 0) throw new PaydayError('Payday amount cannot be negative');
  const errors = validatePaydayRules(rules);
  if (errors.length > 0) throw new PaydayError(errors.join('; '));

  const percents = percentShares(amount, rules);
  let remaining: number = amount;

  const allocations = rules.map((rule, index): Allocation => {
    const requested =
      rule.kind === 'fixed'
        ? rule.amountPaise
        : rule.kind === 'percent'
          ? (percents.get(index) ?? 0)
          : remaining;
    const allocated = Math.min(requested, remaining);
    remaining -= allocated;
    return {
      name: rule.name,
      ...(rule.potId === undefined ? {} : { potId: rule.potId }),
      kind: rule.kind,
      requestedPaise: paise(requested),
      allocatedPaise: paise(allocated),
      shortfallPaise: paise(requested - allocated),
    };
  });

  return { allocations, unallocatedPaise: paise(remaining) };
}
