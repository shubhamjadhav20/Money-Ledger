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

export type TokenScope = 'capture' | 'read' | 'full';

export interface ApiTokensTable {
  id: string;
  name: string;
  scope: TokenScope;
  token_sha256: string;
  created_at: Generated<Date>;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export interface AuditLogTable {
  id: Generated<number>;
  at: Generated<Date>;
  token_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Generated<Record<string, string | number | boolean>>;
}

export interface Database {
  accounts: AccountsTable;
  import_batches: ImportBatchesTable;
  transactions: TransactionsTable;
  api_tokens: ApiTokensTable;
  audit_log: AuditLogTable;
}
