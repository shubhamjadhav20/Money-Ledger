/** Production entrypoint: `node packages/api/src/bin/serve.ts` with DATABASE_URL set. */
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.ts';
import { createPgDb } from '../db/pg-client.ts';
import { migrateToLatest } from '../db/migrations.ts';
import { startServer } from '../server.ts';

const config = loadConfig(process.env);
const db = createPgDb(config.databaseUrl);

const applied = await migrateToLatest(db);
if (applied.length > 0) process.stderr.write(`Applied migrations: ${applied.join(', ')}\n`);

const running = await startServer({ db, host: config.host, port: config.port, newId: randomUUID });
process.stderr.write(`Ledger API listening on ${config.host}:${String(running.port)}\n`);

let stopping = false;
const stop = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  process.stderr.write(`${signal} received, shutting down\n`);
  await running.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
