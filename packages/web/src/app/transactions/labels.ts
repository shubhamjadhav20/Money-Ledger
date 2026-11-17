import type { PaymentMethod, TxKind } from '@ledger/core';
import type { TxStatus } from '../api/models';

export const KIND_LABELS: Readonly<Record<TxKind, string>> = {
  spend: 'Spend',
  income: 'Income',
  transfer: 'Transfer',
  investment: 'Investment',
  family: 'Family',
};

/** One line on what each kind means for the numbers, shown when editing. */
export const KIND_HELP: Readonly<Record<TxKind, string>> = {
  spend: 'Counts as spending.',
  income: 'Money coming in.',
  transfer: 'Moving money between your own accounts. Never counted as spending.',
  investment: 'Money put into investments. Not spending, but not left over either.',
  family: 'Money sent to family. Tracked on its own, not as spending.',
};

export const METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  upi: 'UPI',
  card: 'Card',
  cash: 'Cash',
  netbanking: 'Net banking',
};

export const STATUS_LABELS: Readonly<Record<TxStatus, string>> = {
  pending: 'Pending',
  posted: 'Posted',
};
