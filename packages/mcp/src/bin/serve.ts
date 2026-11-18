/**
 * Entry point: `node packages/mcp/src/bin/serve.ts`, started by an MCP client over stdio.
 * stdout belongs to the protocol. Anything that would print there is sent to stderr instead.
 */
import { format } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { toolsFor } from '@ledger/tools';
import { ApiLedgerService } from '../api-service.ts';
import { McpConfigError, loadMcpConfig } from '../config.ts';
import { stderrLog } from '../log.ts';
import { createLedgerServer } from '../server.ts';

const log = stderrLog();

// A stray console.log from any library must not corrupt the protocol stream.
const toStderr = (...args: unknown[]): void => {
  process.stderr.write(`${format(...args)}\n`);
};
Object.assign(console, { log: toStderr, info: toStderr, debug: toStderr });

let config;
try {
  config = loadMcpConfig(process.env);
} catch (error) {
  log(
    error instanceof McpConfigError
      ? `configuration error: ${error.message}`
      : 'configuration error',
  );
  process.exit(1);
}

const service = new ApiLedgerService({
  baseUrl: config.apiUrl,
  readToken: config.readToken,
  captureToken: config.captureToken,
});

const handle = serveStdio(() => createLedgerServer({ service, write: config.write, log }), {
  onerror: (error) => {
    log(`protocol error: ${error.name}`);
  },
});

for (const note of config.notes) log(note);
log(
  `ready: ${String(toolsFor({ write: config.write }).length)} tools, adding transactions ${config.write ? 'ON' : 'off'}, API ${config.apiUrl}`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void handle.close().finally(() => process.exit(0));
  });
}
