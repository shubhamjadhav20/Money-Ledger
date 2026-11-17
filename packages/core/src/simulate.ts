/**
 * "Can I afford X?" PLAN.md rule 7. Pure: takes today's free-to-spend and returns what changes.
 *
 * - upi:   comes straight off free-to-spend.
 * - card:  lands on the next statement; reduces free-to-spend now under `all_outstanding`,
 *          or only if the due date is by payday under `due_before_payday`.
 * - preset (e.g. slice_in_3): split into N installments on the next N statements of the card;
 *          only installments due by payday reduce free-to-spend now. Fees go on installment 1.
 *
 * Slice in 3 terms (minimum amount, fees, whether it is still offered) are UNVERIFIED: they are
 * config on the preset, not constants. TODO: confirm in the app and set SLICE_IN_3 accordingly.
 */
import { dueDateFor, statementDateFor } from './cycle.ts';
import type { CardCycle } from './cycle.ts';
import { addDays } from './dates.ts';
import type { LocalDate } from './dates.ts';
import type { CardExposureMode } from './free-to-spend.ts';
import { formatINR, negatePaise, paise, subPaise, sumPaise } from './money.ts';
import type { Paise } from './money.ts';

export type InstallmentFee =
  | { readonly kind: 'none' }
  | { readonly kind: 'flat'; readonly paise: Paise }
  | { readonly kind: 'bps'; readonly basisPoints: number };

export interface InstallmentPreset {
  readonly id: string;
  readonly name: string;
  readonly months: number;
  readonly minPrincipalPaise?: Paise;
  readonly fee: InstallmentFee;
}

// TODO(verify in-app): minimum amount and fee terms for Slice in 3.
export const SLICE_IN_3: InstallmentPreset = {
  id: 'slice_in_3',
  name: 'Slice in 3',
  months: 3,
  fee: { kind: 'none' },
};

export interface SimulateContext {
  readonly today: LocalDate;
  readonly freePaise: Paise;
  readonly nextPayday: LocalDate;
  readonly cardExposure: CardExposureMode;
  readonly card?: { readonly name: string; readonly cycle: CardCycle };
  readonly presets: readonly InstallmentPreset[];
}

export interface Installment {
  readonly number: number;
  readonly statementDate: LocalDate;
  readonly dueDate: LocalDate;
  readonly amountPaise: Paise;
}

export interface SimulationResult {
  readonly method: string;
  readonly affordableNow: boolean;
  readonly freeAfterPaise: Paise;
  readonly installments: Installment[];
  readonly cardCharge:
    { statementDate: LocalDate; dueDate: LocalDate; amountPaise: Paise } | undefined;
  readonly warnings: string[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (date: LocalDate): string => {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${String(d)} ${MONTHS[m - 1] ?? ''}`;
};

/** Split `total` into `n` parts that differ by at most one paisa; earlier parts get the extra. */
export function splitInstallments(total: Paise, n: number): Paise[] {
  const base = BigInt(total) / BigInt(n);
  const extra = Number(BigInt(total) % BigInt(n));
  return Array.from({ length: n }, (_, i) => paise(Number(base) + (i < extra ? 1 : 0)));
}

function feeFor(principal: Paise, fee: InstallmentFee): Paise {
  if (fee.kind === 'none') return paise(0);
  if (fee.kind === 'flat') return fee.paise;
  return paise(Number((BigInt(principal) * BigInt(fee.basisPoints) + 9_999n) / 10_000n)); // round up
}

export function simulatePurchase(
  amount: Paise,
  method: string,
  ctx: SimulateContext,
): SimulationResult {
  if (amount <= 0) throw new RangeError('Purchase amount must be positive');
  const warnings: string[] = [];
  const finish = (
    freeAfter: Paise,
    rest: Pick<SimulationResult, 'installments' | 'cardCharge'>,
    forceUnaffordable = false,
  ): SimulationResult => {
    const affordableNow = !forceUnaffordable && freeAfter >= 0;
    if (freeAfter < 0) {
      warnings.push(
        `Leaves you ${formatINR(negatePaise(freeAfter))} short until payday (${shortDate(ctx.nextPayday)}).`,
      );
    }
    return { method, affordableNow, freeAfterPaise: freeAfter, ...rest, warnings };
  };
  const requireCard = (): { name: string; cycle: CardCycle } => {
    if (ctx.card === undefined) throw new Error(`${method} needs a card with a statement cycle`);
    return ctx.card;
  };

  if (method === 'upi')
    return finish(subPaise(ctx.freePaise, amount), { installments: [], cardCharge: undefined });

  if (method === 'card') {
    const { cycle } = requireCard();
    const statementDate = statementDateFor(ctx.today, cycle);
    const dueDate = dueDateFor(statementDate, cycle);
    const countsNow = ctx.cardExposure === 'all_outstanding' || dueDate <= ctx.nextPayday;
    if (!countsNow) {
      warnings.push(
        `${formatINR(amount)} is due on ${shortDate(dueDate)}, after payday (${shortDate(ctx.nextPayday)}).`,
      );
    }
    return finish(countsNow ? subPaise(ctx.freePaise, amount) : ctx.freePaise, {
      installments: [],
      cardCharge: { statementDate, dueDate, amountPaise: amount },
    });
  }

  const preset = ctx.presets.find((p) => p.id === method);
  if (preset === undefined) throw new Error(`Unknown purchase method: ${method}`);
  const { cycle } = requireCard();

  if (preset.minPrincipalPaise !== undefined && amount < preset.minPrincipalPaise) {
    warnings.push(`${preset.name} needs at least ${formatINR(preset.minPrincipalPaise)}.`);
    return finish(ctx.freePaise, { installments: [], cardCharge: undefined }, true);
  }

  const fee = feeFor(amount, preset.fee);
  const parts = splitInstallments(amount, preset.months);
  let statement = statementDateFor(ctx.today, cycle);
  const installments = parts.map((part, i): Installment => {
    if (i > 0) statement = statementDateFor(addDays(statement, 1), cycle);
    return {
      number: i + 1,
      statementDate: statement,
      dueDate: dueDateFor(statement, cycle),
      amountPaise: i === 0 ? paise(part + fee) : part,
    };
  });

  const dueNow = sumPaise(
    installments.filter((i) => i.dueDate <= ctx.nextPayday).map((i) => i.amountPaise),
  );
  const later = installments.filter((i) => i.dueDate > ctx.nextPayday);
  if (later.length > 0) {
    const plural = later.length === 1 ? 'installment' : 'installments';
    warnings.push(
      `${String(later.length)} more ${plural} (${formatINR(sumPaise(later.map((i) => i.amountPaise)))}) fall after payday.`,
    );
  }
  if (fee > 0) warnings.push(`Fee: ${formatINR(fee)}.`);
  return finish(subPaise(ctx.freePaise, dueNow), { installments, cardCharge: undefined });
}
