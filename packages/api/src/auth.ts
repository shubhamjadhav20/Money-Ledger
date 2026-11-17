/**
 * API tokens, audit log and rate limiting. The API is the single enforcement point: every route
 * declares the scope it needs, every mutation is audited, and every token is rate limited.
 *
 * Token secrets are 256 random bits, so a plain sha256 is enough to store them (there is nothing to
 * brute-force, unlike a password). The secret is returned once at creation and never stored.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database, TokenScope } from './db/schema.ts';

export type { TokenScope } from './db/schema.ts';

export const TOKEN_PREFIX = 'led_';
const MAX_HEADER_LENGTH = 200;

/** `full` can do everything; `read` and `capture` only their own scope. */
export function scopeAllows(have: TokenScope, need: TokenScope): boolean {
  return have === 'full' || have === need;
}

export const hashToken = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

export interface CreatedToken {
  readonly id: string;
  /** Shown once. Not recoverable afterwards. */
  readonly secret: string;
}

export async function createToken(
  db: Kysely<Database>,
  input: { readonly name: string; readonly scope: TokenScope },
  newId: () => string,
): Promise<CreatedToken> {
  const id = newId();
  const secret = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  await db
    .insertInto('api_tokens')
    .values({
      id,
      name: input.name,
      scope: input.scope,
      token_sha256: hashToken(secret),
      last_used_at: null,
      revoked_at: null,
    })
    .execute();
  return { id, secret };
}

export interface Principal {
  readonly id: string;
  readonly name: string;
  readonly scope: TokenScope;
}

/** Resolves an `Authorization: Bearer ...` header to a live token, or undefined. */
export async function verifyBearer(
  db: Kysely<Database>,
  header: string | undefined,
): Promise<Principal | undefined> {
  if (header === undefined || header.length > MAX_HEADER_LENGTH) return undefined;
  const match = /^Bearer (led_[A-Za-z0-9_-]{43})$/u.exec(header);
  const secret = match?.[1];
  if (secret === undefined) return undefined;

  const row = await db
    .selectFrom('api_tokens')
    .select(['id', 'name', 'scope'])
    .where('token_sha256', '=', hashToken(secret))
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (row === undefined) return undefined;

  // Touch at most once a minute so reads do not become writes.
  await db
    .updateTable('api_tokens')
    .set({ last_used_at: sql<Date>`now()` })
    .where('id', '=', row.id)
    .where((eb) =>
      eb.or([
        eb('last_used_at', 'is', null),
        eb('last_used_at', '<', sql<Date>`now() - interval '1 minute'`),
      ]),
    )
    .execute();
  return row;
}

export async function revokeToken(db: Kysely<Database>, id: string): Promise<boolean> {
  const result = await db
    .updateTable('api_tokens')
    .set({ revoked_at: sql<Date>`now()` })
    .where('id', '=', id)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export interface TokenListing {
  readonly id: string;
  readonly name: string;
  readonly scope: TokenScope;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revoked: boolean;
}

/** Never includes secret material (not even the hash). */
export async function listTokens(db: Kysely<Database>): Promise<TokenListing[]> {
  const rows = await db
    .selectFrom('api_tokens')
    .select(['id', 'name', 'scope', 'created_at', 'last_used_at', 'revoked_at'])
    .orderBy('name')
    .orderBy('id')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    scope: r.scope,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revoked: r.revoked_at !== null,
  }));
}

export interface AuditEntry {
  readonly tokenId: string | null;
  readonly action: string;
  readonly entity: string;
  readonly entityId?: string;
  /** Counts and ids only. Never memos, counterparties or message text. */
  readonly detail?: Record<string, string | number | boolean>;
}

export async function recordAudit(db: Kysely<Database>, entry: AuditEntry): Promise<void> {
  await db
    .insertInto('audit_log')
    .values({
      token_id: entry.tokenId,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      detail: JSON.stringify(entry.detail ?? {}) as never,
    })
    .execute();
}

export interface RateLimiter {
  /** Records a hit; false when the key is over its limit for the current window. */
  hit(key: string): boolean;
  size(): number;
}

/** Fixed-window, in-memory, per key. Enough for a single-process personal API. */
export function createRateLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
  readonly maxKeys?: number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, { count: number; resetAt: number }>();

  const makeRoom = (): void => {
    const t = now();
    for (const [key, w] of windows) if (w.resetAt <= t) windows.delete(key);
    for (const key of windows.keys()) {
      if (windows.size < maxKeys) break;
      windows.delete(key); // oldest first (Map keeps insertion order)
    }
  };

  return {
    hit(key) {
      const t = now();
      const current = windows.get(key);
      if (current === undefined || current.resetAt <= t) {
        if (windows.size >= maxKeys) makeRoom();
        windows.set(key, { count: 1, resetAt: t + options.windowMs });
        return true;
      }
      current.count += 1;
      return current.count <= options.limit;
    },
    size: () => windows.size,
  };
}
