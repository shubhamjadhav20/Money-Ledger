/** Shared domain vocabulary (PLAN.md section 4). Entities grow milestone by milestone. */
import type { LocalDate } from './dates.ts';
import type { Paise } from './money.ts';

export const ACCOUNT_KINDS = ['bank', 'card', 'savings', 'cash'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Transfers (own-account moves, card-bill payments) are never spend. */
export const TX_KINDS = ['spend', 'income', 'transfer'] as const;
export type TxKind = (typeof TX_KINDS)[number];

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
