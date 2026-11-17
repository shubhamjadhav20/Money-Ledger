/** Starts the HTTP server for an already-connected database. Owns the listener, not the database. */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Kysely } from 'kysely';
import { createApp } from './app.ts';
import type { AppOptions } from './app.ts';
import type { Database } from './db/schema.ts';

export interface RunningServer {
  readonly port: number;
  /** Stops accepting connections and waits for in-flight requests to finish. */
  close(): Promise<void>;
}

export async function startServer(
  options: Omit<AppOptions, 'db'> & {
    readonly db: Kysely<Database>;
    readonly host: string;
    readonly port: number;
  },
): Promise<RunningServer> {
  const { host, port, ...appOptions } = options;
  const app = createApp(appOptions);
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, host, () => {
      resolve(s);
    });
    s.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
        server.closeIdleConnections();
      }),
  };
}
