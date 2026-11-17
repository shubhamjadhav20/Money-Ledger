/**
 * Pots: earmarked money. A pot's balance is DERIVED from an append-only journal of movements,
 * never stored and edited, so it cannot drift. A true-up is an adjusting movement.
 */
import type { LocalDate } from './dates.ts';
import { paise, subPaise } from './money.ts';
import type { Paise } from './money.ts';
import type { PaydayResult } from './payday.ts';

export type PotKind = 'buffer' | 'bill' | 'spend';

export interface Pot {
  readonly id: string;
  readonly name: string;
  /** buffer: safety money; bill: reserved for a bill; spend: free to use. */
  readonly kind: PotKind;
  readonly targetPaise?: Paise;
  /** For bill pots: when the bill is next due. */
  readonly dueDate?: LocalDate;
}

export interface PotMovement {
  readonly id: string;
  readonly potId: string;
  readonly amountPaise: Paise;
  readonly reason: 'payday' | 'spend' | 'trueup' | 'manual';
  readonly date: LocalDate;
  readonly paydayRunId?: string;
}

export function potBalances(
  pots: readonly Pot[],
  movements: readonly PotMovement[],
): Map<string, Paise> {
  const balances = new Map<string, number>(pots.map((p) => [p.id, 0]));
  for (const m of movements) {
    const current = balances.get(m.potId);
    if (current === undefined) throw new Error(`Movement ${m.id} is for unknown pot ${m.potId}`);
    balances.set(m.potId, paise(current + m.amountPaise));
  }
  return new Map([...balances].map(([id, value]) => [id, paise(value)]));
}

/** Journal entries for the pot-bound allocations of a payday run. Ids are stable per run. */
export function paydayMovements(
  result: PaydayResult,
  date: LocalDate,
  runId: string,
): PotMovement[] {
  return result.allocations.flatMap((a, index) =>
    a.potId === undefined || a.allocatedPaise === 0
      ? []
      : [
          {
            id: `${runId}:${String(index)}`,
            potId: a.potId,
            amountPaise: a.allocatedPaise,
            reason: 'payday' as const,
            date,
            paydayRunId: runId,
          },
        ],
  );
}

/** The adjusting entry that brings a pot from `expected` to the `actual` balance, if any. */
export function trueUpMovement(
  potId: string,
  expected: Paise,
  actual: Paise,
  date: LocalDate,
  id: string,
): PotMovement | undefined {
  const gap = subPaise(actual, expected);
  return gap === 0 ? undefined : { id, potId, amountPaise: gap, reason: 'trueup', date };
}
