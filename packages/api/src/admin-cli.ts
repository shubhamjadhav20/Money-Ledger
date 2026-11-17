/**
 * Admin commands run on the server host (never over HTTP): add accounts and mint API tokens.
 * Kept free of process globals so it can be tested; bin/admin.ts wires it to the real console.
 */
import { parseArgs } from 'node:util';
import type { AccountKind } from '@ledger/core';
import type { Kysely } from 'kysely';
import { createToken, listTokens, recordAudit } from './auth.ts';
import type { TokenScope } from './auth.ts';
import type { Database } from './db/schema.ts';

export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE = [
  'Usage:',
  '  create-token --name <name> --scope <capture|read|full>',
  '  list-tokens',
  '  add-account --id <id> --name <name> --kind <bank|card|savings|cash> [--statement-day N --due-day N]',
  '  list-accounts',
];

const ACCOUNT_KINDS: readonly AccountKind[] = ['bank', 'card', 'savings', 'cash'];
const SCOPES: readonly TokenScope[] = ['capture', 'read', 'full'];

const isOneOf = <T extends string>(allowed: readonly T[], value: string | undefined): value is T =>
  value !== undefined && (allowed as readonly string[]).includes(value);

function day(value: string | undefined): number | undefined | 'invalid' {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : 'invalid';
}

export async function runAdmin(
  db: Kysely<Database>,
  argv: readonly string[],
  newId: () => string,
  io: Io,
): Promise<number> {
  const [command, ...rest] = argv;
  const usage = (): number => {
    for (const line of USAGE) io.err(line);
    return 1;
  };
  if (command === undefined) return usage();

  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...rest],
      strict: true,
      options: {
        name: { type: 'string' },
        scope: { type: 'string' },
        id: { type: 'string' },
        kind: { type: 'string' },
        'statement-day': { type: 'string' },
        'due-day': { type: 'string' },
      },
    }));
  } catch (error) {
    io.err(error instanceof Error ? error.message : 'Invalid arguments');
    return usage();
  }

  switch (command) {
    case 'create-token': {
      if (
        values['name'] === undefined ||
        values['name'].length === 0 ||
        values['name'].length > 60
      ) {
        io.err('--name is required (1 to 60 characters)');
        return 1;
      }
      if (!isOneOf(SCOPES, values['scope'])) {
        io.err('--scope must be capture, read or full');
        return 1;
      }
      const created = await createToken(
        db,
        { name: values['name'], scope: values['scope'] },
        newId,
      );
      await recordAudit(db, {
        tokenId: null,
        action: 'token.create',
        entity: 'api_token',
        entityId: created.id,
        detail: { scope: values['scope'], by: 'admin-cli' },
      });
      io.out(
        `Token ${created.id} (${values['scope']}) created. Copy it now, it is shown only once:`,
      );
      io.out(created.secret);
      return 0;
    }
    case 'list-tokens': {
      for (const t of await listTokens(db)) {
        io.out(`${t.id}  ${t.scope.padEnd(7)}  ${t.name}${t.revoked ? '  (revoked)' : ''}`);
      }
      return 0;
    }
    case 'add-account': {
      const { id, name, kind } = values;
      if (id === undefined || id.length === 0 || id.length > 64) {
        io.err('--id is required (1 to 64 characters)');
        return 1;
      }
      if (name === undefined || name.length === 0 || name.length > 80) {
        io.err('--name is required (1 to 80 characters)');
        return 1;
      }
      if (!isOneOf(ACCOUNT_KINDS, kind)) {
        io.err('--kind must be bank, card, savings or cash');
        return 1;
      }
      const statementDay = day(values['statement-day']);
      const dueDay = day(values['due-day']);
      if (statementDay === 'invalid' || dueDay === 'invalid') {
        io.err('--statement-day and --due-day must be whole numbers from 1 to 31');
        return 1;
      }
      if ((statementDay === undefined) !== (dueDay === undefined)) {
        io.err('Give both --statement-day and --due-day, or neither');
        return 1;
      }
      const existing = await db
        .selectFrom('accounts')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (existing !== undefined) {
        io.err(`An account with id ${id} already exists`);
        return 1;
      }
      await db
        .insertInto('accounts')
        .values({ id, name, kind, statement_day: statementDay ?? null, due_day: dueDay ?? null })
        .execute();
      await recordAudit(db, {
        tokenId: null,
        action: 'account.create',
        entity: 'account',
        entityId: id,
        detail: { by: 'admin-cli' },
      });
      io.out(`Account ${id} (${kind}) added`);
      return 0;
    }
    case 'list-accounts': {
      for (const a of await db.selectFrom('accounts').selectAll().orderBy('id').execute()) {
        const cycle =
          a.statement_day === null
            ? ''
            : `  statement day ${String(a.statement_day)}, due day ${String(a.due_day)}`;
        io.out(`${a.id}  ${a.kind.padEnd(7)}  ${a.name}${cycle}`);
      }
      return 0;
    }
    default:
      return usage();
  }
}
