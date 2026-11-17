import type { Selectable } from 'kysely';
import type { TransactionsTable } from './db/schema.ts';

/** The one JSON shape a transaction has on the wire. */
export const transactionView = (r: Selectable<TransactionsTable>) => ({
  id: r.id,
  accountId: r.account_id,
  date: r.date,
  amountPaise: r.amount,
  counterparty: r.counterparty,
  memo: r.memo,
  category: r.category,
  kind: r.kind,
  method: r.method,
  status: r.status,
  source: r.source,
});
