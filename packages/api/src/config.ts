/**
 * Runtime configuration from environment variables. Errors never contain the database URL or
 * password: they name the variable and the rule only.
 */
import { z } from 'zod';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface Config {
  readonly databaseUrl: string;
  /** Loopback by default: exposing the API is a deliberate choice (reverse proxy or private network). */
  readonly host: string;
  readonly port: number;
}

const schema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(?:ql)?:\/\/\S+$/u, 'must be a postgres:// or postgresql:// URL'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration (${problems})`);
  }
  return { databaseUrl: result.data.DATABASE_URL, host: result.data.HOST, port: result.data.PORT };
}
