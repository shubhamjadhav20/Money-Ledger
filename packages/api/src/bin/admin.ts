/** Admin entrypoint: `node packages/api/src/bin/admin.ts <command>` with DATABASE_URL set. */
import { randomUUID } from 'node:crypto';
import { runAdmin } from '../admin-cli.ts';
import { loadConfig } from '../config.ts';
import { migrateToLatest } from '../db/migrations.ts';
import { createPgDb } from '../db/pg-client.ts';

const config = loadConfig(process.env);
const db = createPgDb(config.databaseUrl, 1);
let code: number;
try {
  await migrateToLatest(db);
  code = await runAdmin(db, process.argv.slice(2), randomUUID, {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
} finally {
  await db.destroy();
}
process.exit(code);
