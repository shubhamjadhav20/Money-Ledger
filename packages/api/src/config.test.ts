import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const URL_OK = 'postgres://ledger:s3cret-pw@localhost:5432/ledger';

describe('loadConfig()', () => {
  it('reads the database URL and applies safe defaults (loopback only)', () => {
    expect(loadConfig({ DATABASE_URL: URL_OK })).toEqual({
      databaseUrl: URL_OK,
      host: '127.0.0.1',
      port: 3000,
    });
  });

  it('accepts postgresql:// and explicit host and port', () => {
    const url = 'postgresql://u:p@db/ledger?sslmode=require';
    expect(loadConfig({ DATABASE_URL: url, HOST: '0.0.0.0', PORT: '8080' })).toEqual({
      databaseUrl: url,
      host: '0.0.0.0',
      port: 8080,
    });
  });

  it.each([
    ['missing URL', {}],
    ['not a postgres URL', { DATABASE_URL: 'mysql://u:p@h/db' }],
    ['garbage URL', { DATABASE_URL: 'not a url' }],
    ['port not a number', { DATABASE_URL: URL_OK, PORT: 'abc' }],
    ['port out of range', { DATABASE_URL: URL_OK, PORT: '70000' }],
    ['port zero', { DATABASE_URL: URL_OK, PORT: '0' }],
    ['empty host', { DATABASE_URL: URL_OK, HOST: '' }],
  ])('rejects %s', (_name, env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it('never puts the database URL or password in an error message', () => {
    for (const env of [
      { DATABASE_URL: 'mysql://ledger:s3cret-pw@h/db' },
      { DATABASE_URL: URL_OK, PORT: 'x' },
    ]) {
      try {
        loadConfig(env);
        expect.unreachable();
      } catch (error) {
        expect(String(error)).not.toContain('s3cret-pw');
        expect(String(error)).not.toContain('ledger:');
      }
    }
  });
});
