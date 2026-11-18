import { PAYMENT_METHODS } from '@ledger/core';
import type { PaymentMethod } from '@ledger/core';

export type Direction = 'spent' | 'received';
export type Day = 'today' | 'yesterday';

export const DIRECTIONS: readonly Direction[] = ['spent', 'received'];
export const DAYS: readonly Day[] = ['today', 'yesterday'];
export const METHODS: readonly PaymentMethod[] = PAYMENT_METHODS;

export interface QuickAddFields {
  readonly direction: Direction;
  readonly amount: string;
  readonly category: string;
  readonly note: string;
  readonly method: PaymentMethod;
  readonly day: Day;
}

/**
 * The fields as one line of the quick-add grammar ("got 5000 salary upi today"). The server reads
 * this same line with the same function, so what the preview shows is what is stored.
 *
 * Each field is kept to the shape its slot has in the grammar: no spaces inside the amount, no
 * leading sign (the Spent/Received choice decides that), and spaces in the category become
 * hyphens. The note goes in as typed; if it contains a method or a date word the grammar reads it
 * as one, and the preview shows that before anything is saved.
 */
export function composeCapture(fields: QuickAddFields): string {
  const amount = fields.amount.replace(/\s+/gu, '').replace(/^[+-]+/u, '');
  const category = fields.category.trim().replace(/\s+/gu, '-');
  const note = fields.note.trim().replace(/\s+/gu, ' ');
  return [
    fields.direction === 'received' ? 'got' : '',
    amount,
    category,
    note,
    fields.method,
    fields.day,
  ]
    .filter((part) => part !== '')
    .join(' ');
}
