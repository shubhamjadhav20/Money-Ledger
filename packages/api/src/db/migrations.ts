/**
 * Forward-only SQL migrations, applied in name order inside a transaction each (Kysely Migrator).
 * Never edit a migration that has run anywhere: add a new one.
 */
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Database } from './schema.ts';
import type { Migration, MigrationProvider } from 'kysely/migration';

const KINDS = `'spend','income','transfer','investment','family'`;
const METHODS = `'upi','card','cash','netbanking'`;

const migrations: Record<string, Migration> = {
  '001_core_tables': {
    async up(db: Kysely<unknown>) {
      await sql`
        create table accounts (
          id text primary key,
          name text not null check (length(name) between 1 and 80),
          kind text not null check (kind in ('bank','card','savings','cash')),
          statement_day int check (statement_day between 1 and 31),
          due_day int check (due_day between 1 and 31),
          check ((statement_day is null) = (due_day is null))
        )`.execute(db);

      await sql`
        create table import_batches (
          id text primary key,
          account_id text not null references accounts (id),
          source text not null check (source in ('csv','pdf','aa-sandbox')),
          imported_at timestamptz not null default now(),
          row_count int not null check (row_count >= 0),
          content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$')
        )`.execute(db);

      await sql`
        create table transactions (
          id text primary key,
          account_id text not null references accounts (id),
          date date not null,
          amount bigint not null check (amount <> 0),
          counterparty text not null default '',
          ref text,
          memo text not null default '',
          category text,
          kind text not null check (kind in (${sql.raw(KINDS)})),
          method text not null check (method in (${sql.raw(METHODS)})),
          import_batch_id text references import_batches (id),
          identity text,
          source text not null check (source in ('manual','import','sms')),
          status text not null check (status in ('pending','posted')),
          created_at timestamptz not null default now(),
          -- A transaction has a statement identity exactly when the bank has posted it.
          check ((status = 'posted') = (identity is not null)),
          -- Statement rows are always posted; cash never appears on a statement.
          check (source <> 'import' or status = 'posted'),
          check (method <> 'cash' or status = 'pending'),
          -- The database refuses what the exactly-once invariant forbids: the same statement row twice.
          unique (account_id, identity)
        )`.execute(db);

      await sql`create index transactions_account_date_idx on transactions (account_id, date)`.execute(
        db,
      );
      await sql`
        create index transactions_pending_idx on transactions (account_id) where status = 'pending'`.execute(
        db,
      );
    },
  },
  '002_tokens_and_audit': {
    async up(db: Kysely<unknown>) {
      await sql`
        create table api_tokens (
          id text primary key,
          name text not null check (length(name) between 1 and 60),
          scope text not null check (scope in ('capture','read','full')),
          -- sha256 of a 256-bit random secret; the secret itself is shown once and never stored.
          token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
          created_at timestamptz not null default now(),
          last_used_at timestamptz,
          revoked_at timestamptz
        )`.execute(db);

      await sql`
        create table audit_log (
          id bigint generated always as identity primary key,
          at timestamptz not null default now(),
          token_id text references api_tokens (id),
          action text not null,
          entity text not null,
          entity_id text,
          -- counts and ids only: never memos, counterparties or message bodies.
          detail jsonb not null default '{}'::jsonb
        )`.execute(db);

      await sql`
        create function audit_log_append_only() returns trigger language plpgsql as $$
        begin
          raise exception 'audit_log is append-only';
        end $$`.execute(db);
      await sql`
        create trigger audit_log_no_change before update or delete on audit_log
        for each row execute function audit_log_append_only()`.execute(db);
      await sql`
        create trigger audit_log_no_truncate before truncate on audit_log
        for each statement execute function audit_log_append_only()`.execute(db);
    },
  },
  '003_planning': {
    async up(db: Kysely<unknown>) {
      // One row of user settings. Defaults are placeholders the user can change (PATCH /settings).
      await sql`
        create table settings (
          id int primary key check (id = 1),
          payday_day int not null check (payday_day between 1 and 31),
          payday_weekend text not null check (payday_weekend in ('none','previous-weekday')),
          card_exposure text not null check (card_exposure in ('all_outstanding','due_before_payday'))
        )`.execute(db);
      await sql`
        insert into settings (id, payday_day, payday_weekend, card_exposure)
        values (1, 7, 'previous-weekday', 'all_outstanding')`.execute(db);

      await sql`
        create table pots (
          id text primary key,
          name text not null check (length(name) between 1 and 60),
          kind text not null check (kind in ('buffer','bill','spend')),
          target_paise bigint check (target_paise >= 0),
          due_date date,
          covers_card_account_id text references accounts (id),
          created_at timestamptz not null default now(),
          check (due_date is null or kind = 'bill'),
          check (covers_card_account_id is null or kind = 'bill')
        )`.execute(db);

      // The journal. A pot's balance is the sum of its movements and is never stored.
      await sql`
        create table payday_runs (
          id text primary key,
          date date not null,
          amount_paise bigint not null check (amount_paise > 0),
          created_at timestamptz not null default now()
        )`.execute(db);
      await sql`
        create table pot_movements (
          id text primary key,
          pot_id text not null references pots (id),
          amount_paise bigint not null check (amount_paise <> 0),
          reason text not null check (reason in ('payday','spend','trueup','manual')),
          date date not null,
          payday_run_id text references payday_runs (id),
          created_at timestamptz not null default now(),
          check ((reason = 'payday') = (payday_run_id is not null))
        )`.execute(db);
      await sql`
        create function journal_append_only() returns trigger language plpgsql as $$
        begin
          raise exception '% is append-only', tg_table_name;
        end $$`.execute(db);
      for (const table of ['pot_movements', 'payday_runs']) {
        await sql`
          create trigger ${sql.raw(`${table}_no_change`)} before update or delete on ${sql.table(table)}
          for each row execute function journal_append_only()`.execute(db);
        await sql`
          create trigger ${sql.raw(`${table}_no_truncate`)} before truncate on ${sql.table(table)}
          for each statement execute function journal_append_only()`.execute(db);
      }

      await sql`
        create table payday_rules (
          id text primary key,
          position int not null unique check (position >= 0),
          name text not null check (length(name) between 1 and 60),
          kind text not null check (kind in ('fixed','percent','remainder')),
          amount_paise bigint check (amount_paise >= 0),
          basis_points int check (basis_points between 0 and 10000),
          pot_id text references pots (id),
          check (
            (kind = 'fixed' and amount_paise is not null and basis_points is null) or
            (kind = 'percent' and basis_points is not null and amount_paise is null) or
            (kind = 'remainder' and amount_paise is null and basis_points is null)
          )
        )`.execute(db);

      // Known one-off or monthly outflows outside pots (recharge, an installment).
      await sql`
        create table scheduled_items (
          id text primary key,
          name text not null check (length(name) between 1 and 60),
          amount_paise bigint not null check (amount_paise > 0),
          date date,
          monthly_day int check (monthly_day between 1 and 31),
          created_at timestamptz not null default now(),
          check ((date is null) <> (monthly_day is null))
        )`.execute(db);

      // The user's reality anchor: "my bank balance was X on this date". Cards store a negative
      // amount when money is owed. Balances after the checkpoint are derived from transactions.
      await sql`
        create table balance_checkpoints (
          id text primary key,
          account_id text not null references accounts (id),
          date date not null,
          amount_paise bigint not null,
          created_at timestamptz not null default now(),
          unique (account_id, date)
        )`.execute(db);
    },
  },
};

const provider: MigrationProvider = { getMigrations: () => Promise.resolve(migrations) };

/** Applies every pending migration. Throws (and rolls the failing one back) on error. */
export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const { error, results } = await new Migrator({ db, provider }).migrateToLatest();
  if (error !== undefined) {
    throw error instanceof Error ? error : new Error('Migration failed');
  }
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
