/** Shared domain vocabulary (PLAN.md section 4). Entities grow milestone by milestone. */
import type { LocalDate } from './dates.ts';
import type { Paise } from './money.ts';

export const ACCOUNT_KINDS = ['bank', 'card', 'savings', 'cash'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/**
 * What a transaction is, before any category:
 * - spend: ordinary purchases (and refunds of them)
 * - income: salary, gifts
 * - transfer: own-account moves and card-bill payments; never spend
 * - investment: SIP, mutual funds, stocks; money saved, not spent
 * - family: money sent home (household contribution), reported separately from spend
 */
export const TX_KINDS = ['spend', 'income', 'transfer', 'investment', 'family'] as const;
export type TxKind = (typeof TX_KINDS)[number];

/**
 * Kinds that move money but are not day-to-day purchases. They are planned in pots / the payday
 * waterfall, so they are excluded from reconcile, burn and free-to-spend inputs.
 */
const NON_PURCHASE_KINDS: ReadonlySet<TxKind> = new Set(['transfer', 'investment', 'family']);

export function isPurchaseFlow(kind: TxKind | undefined): boolean {
  return kind === undefined || !NON_PURCHASE_KINDS.has(kind);
}

/** How a payment was made. UPI is a method drawn from a bank account, not an account. */
export const PAYMENT_METHODS = ['upi', 'card', 'cash', 'netbanking'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly cycle?: { readonly statementDay: number; readonly dueDay: number };
}

/** The fields core logic needs from a stored transaction. */
export interface LedgerTx {
  readonly id: string;
  readonly accountId: string;
  readonly date: LocalDate;
  /** Signed: negative = money out of this account. */
  readonly amount: Paise;
  readonly counterparty: string;
  readonly memo: string;
}
