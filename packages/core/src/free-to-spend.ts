/**
 * Free to spend until payday: the headline number. PLAN.md rule 5b.
 *
 *   free = liquid balances (bank + savings + cash)
 *        - card reserve      per card: max(exposure, balance of bill pots that cover it)
 *        - pot reserves      buffer pots and bill pots due by payday: max(balance, target);
 *                            other bill pots: balance; spend pots: nothing
 *        - pending outflows  manual/SMS entries not yet on a statement
 *        - scheduled outflows dated today..payday (installments, known bills outside pots)
 *
 * card exposure: `all_outstanding` (default, conservative) or `due_before_payday`.
 * Every term is returned as a line so the UI / MCP can explain the number. Lines sum to free.
 */
import { daysBetween } from './dates.ts';
import type { LocalDate } from './dates.ts';
import { negatePaise, paise, sumPaise } from './money.ts';
import type { Paise } from './money.ts';
import type { Pot } from './pots.ts';

export type CardExposureMode = 'all_outstanding' | 'due_before_payday';

export interface FreeToSpendInput {
  readonly today: LocalDate;
  readonly nextPayday: LocalDate;
  readonly cardExposure: CardExposureMode;
  readonly liquidBalances: readonly { readonly accountId: string; readonly balancePaise: Paise }[];
  readonly cards: readonly {
    readonly accountId: string;
    readonly name: string;
    /** Everything owed on the card now (positive). */
    readonly outstandingPaise: Paise;
    /** Statement amounts due on or before next payday (positive). */
    readonly dueBeforePaydayPaise: Paise;
  }[];
  readonly pots: readonly {
    readonly pot: Pot;
    readonly balancePaise: Paise;
  }[];
  /** Pending (not yet posted) entries; outflows are negative. */
  readonly pendingOutflows: readonly { readonly id: string; readonly amountPaise: Paise }[];
  /** Known future outflows (positive amounts), counted if dated today..payday. */
  readonly scheduledOutflows: readonly {
    readonly label: string;
    readonly date: LocalDate;
    readonly amountPaise: Paise;
  }[];
}

export interface FreeToSpendLine {
  readonly label: string;
  /** Signed contribution: balances positive, reserves negative. */
  readonly amountPaise: Paise;
}

export interface FreeToSpendResult {
  readonly freePaise: Paise;
  readonly nextPayday: LocalDate;
  readonly daysToPayday: number;
  readonly lines: FreeToSpendLine[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (date: LocalDate): string => {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${String(d)} ${MONTHS[m - 1] ?? ''}`;
};

const max = (a: Paise, b: Paise): Paise => (a > b ? a : b);

export function freeToSpend(input: FreeToSpendInput): FreeToSpendResult {
  const lines: FreeToSpendLine[] = [];
  const deduct = (label: string, amount: Paise): void => {
    if (amount !== 0) lines.push({ label, amountPaise: negatePaise(amount) });
  };

  lines.push({
    label: 'Bank, savings and cash',
    amountPaise: sumPaise(input.liquidBalances.map((b) => b.balancePaise)),
  });

  for (const card of input.cards) {
    const exposure =
      input.cardExposure === 'all_outstanding' ? card.outstandingPaise : card.dueBeforePaydayPaise;
    const covering = sumPaise(
      input.pots
        .filter((p) => p.pot.coversCardAccountId === card.accountId)
        .map((p) => p.balancePaise),
    );
    deduct(`${card.name} owed`, max(exposure, covering));
  }

  for (const { pot, balancePaise } of input.pots) {
    if (pot.coversCardAccountId !== undefined || pot.kind === 'spend') continue;
    const dueByPayday =
      pot.kind === 'buffer' || pot.dueDate === undefined || pot.dueDate <= input.nextPayday;
    const reserve = dueByPayday ? max(balancePaise, pot.targetPaise ?? paise(0)) : balancePaise;
    deduct(`${pot.name} pot`, reserve);
  }

  const pending = sumPaise(
    input.pendingOutflows.filter((p) => p.amountPaise < 0).map((p) => negatePaise(p.amountPaise)),
  );
  deduct('Pending entries not yet on a statement', pending);

  for (const s of input.scheduledOutflows) {
    if (s.date >= input.today && s.date <= input.nextPayday)
      deduct(`${s.label} (${shortDate(s.date)})`, s.amountPaise);
  }

  return {
    freePaise: sumPaise(lines.map((l) => l.amountPaise)),
    nextPayday: input.nextPayday,
    daysToPayday: daysBetween(input.today, input.nextPayday),
    lines,
  };
}
