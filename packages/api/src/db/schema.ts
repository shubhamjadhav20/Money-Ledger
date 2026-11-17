/**
 * Kysely table types. Money is `Paise` (branded integer), dates are `LocalDate` (YYYY-MM-DD):
 * the PGlite/pg clients are configured to return `bigint` as a safe number and `date` as text,
 * so what the types claim is what the driver returns (see client.ts).
 */
import type { ColumnType, Generated } from 'kysely';
import type { AccountKind, LocalDate, Paise, PaymentMethod, TxKind } from '@ledger/core';

export interface AccountsTable {
  id: string;
  name: string;
  kind: AccountKind;
  statement_day: number | null;
  due_day: number | null;
}

export interface ImportBatchesTable {
  id: string;
  account_id: string;
  source: 'csv' | 'pdf' | 'aa-sandbox';
  imported_at: Generated<Date>;
  row_count: number;
  content_sha256: string;
}

export interface TransactionsTable {
  id: string;
  account_id: string;
  date: LocalDate;
  amount: Paise;
  counterparty: Generated<string>;
  ref: string | null;
  memo: Generated<string>;
  category: string | null;
  kind: TxKind;
  method: PaymentMethod;
  import_batch_id: string | null;
  /** `base#occurrence` from core's import identity. Set exactly when status = 'posted'. */
  identity: string | null;
  source: 'manual' | 'import' | 'sms';
  status: 'pending' | 'posted';
  created_at: ColumnType<Date, never, never>;
}

export interface Database {
  accounts: AccountsTable;
  import_batches: ImportBatchesTable;
  transactions: TransactionsTable;
}
