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
