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

export interface SettingsTable {
  id: number;
  payday_day: number;
  payday_weekend: 'none' | 'previous-weekday';
  card_exposure: 'all_outstanding' | 'due_before_payday';
}

export interface PotsTable {
  id: string;
  name: string;
  kind: 'buffer' | 'bill' | 'spend';
  target_paise: Paise | null;
  due_date: LocalDate | null;
  covers_card_account_id: string | null;
  created_at: Generated<Date>;
}

export interface PaydayRunsTable {
  id: string;
  date: LocalDate;
  amount_paise: Paise;
  created_at: Generated<Date>;
}

export interface PotMovementsTable {
  id: string;
  pot_id: string;
  amount_paise: Paise;
  reason: 'payday' | 'spend' | 'trueup' | 'manual';
  date: LocalDate;
  payday_run_id: string | null;
  created_at: Generated<Date>;
}

export interface PaydayRulesTable {
  id: string;
  position: number;
  name: string;
  kind: 'fixed' | 'percent' | 'remainder';
  amount_paise: Paise | null;
  basis_points: number | null;
  pot_id: string | null;
}

export interface ScheduledItemsTable {
  id: string;
  name: string;
  amount_paise: Paise;
  date: LocalDate | null;
  monthly_day: number | null;
  created_at: Generated<Date>;
}

export interface BalanceCheckpointsTable {
  id: string;
  account_id: string;
  date: LocalDate;
  amount_paise: Paise;
  created_at: Generated<Date>;
}

export interface Database {
  accounts: AccountsTable;
  import_batches: ImportBatchesTable;
  transactions: TransactionsTable;
  api_tokens: ApiTokensTable;
  audit_log: AuditLogTable;
  settings: SettingsTable;
  pots: PotsTable;
  payday_runs: PaydayRunsTable;
  pot_movements: PotMovementsTable;
  payday_rules: PaydayRulesTable;
  scheduled_items: ScheduledItemsTable;
  balance_checkpoints: BalanceCheckpointsTable;
}
