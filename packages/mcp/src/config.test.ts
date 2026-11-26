import { describe, expect, it } from 'vitest';
import { DEFAULT_API_URL, McpConfigError, loadMcpConfig } from './config.ts';

const READ = 'led_read_secret_value';
const CAPTURE = 'led_capture_secret_value';

describe('loadMcpConfig', () => {
  it('needs a read token and defaults to the local API, read only', () => {
    expect(() => loadMcpConfig({})).toThrow('LEDGER_API_TOKEN is required');
    expect(loadMcpConfig({ LEDGER_API_TOKEN: ` ${READ} ` })).toEqual({
      apiUrl: DEFAULT_API_URL,
      readToken: READ,
      write: false,
      captureToken: undefined,
      notes: [],
    });
  });

  it('keeps only the origin of the API address', () => {
    expect(
      loadMcpConfig({ LEDGER_API_TOKEN: READ, LEDGER_API_URL: 'http://localhost:4000/' }).apiUrl,
    ).toBe('http://localhost:4000');
    expect(
      loadMcpConfig({ LEDGER_API_TOKEN: READ, LEDGER_API_URL: 'https://ledger.example.com' })
        .apiUrl,
    ).toBe('https://ledger.example.com');
  });

  it.each([
    ['not a url', 'LEDGER_API_URL is not a valid URL'],
    ['ftp://127.0.0.1', 'must start with http:// or https://'],
    ['http://user:pw@127.0.0.1:3000', 'must not contain a user name or password'],
    ['http://127.0.0.1:3000/api', 'no path or query'],
    ['http://127.0.0.1:3000/?a=1', 'no path or query'],
    ['http://ledger.example.com', 'must use https:// unless it points at this computer'],
  ])('rejects the API address %j', (url, message) => {
    expect(() => loadMcpConfig({ LEDGER_API_TOKEN: READ, LEDGER_API_URL: url })).toThrow(message);
  });

  it('rejects a token with spaces without echoing it', () => {
    const bad = 'led_a b';
    try {
      loadMcpConfig({ LEDGER_API_TOKEN: bad });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(McpConfigError);
      expect((error as Error).message).not.toContain('led_a');
    }
  });

  describe('write mode', () => {
    it('is off unless the flag is exactly 1', () => {
      for (const flag of [undefined, '', '0']) {
        const config = loadMcpConfig({
          LEDGER_API_TOKEN: READ,
          ...(flag === undefined ? {} : { LEDGER_MCP_WRITE: flag }),
        });
        expect(config.write).toBe(false);
      }
      for (const flag of ['true', 'yes', '2', 'on']) {
        expect(() => loadMcpConfig({ LEDGER_API_TOKEN: READ, LEDGER_MCP_WRITE: flag })).toThrow(
          'must be 1',
        );
      }
    });

    it('needs its own capture token, different from the read token', () => {
      const env = { LEDGER_API_TOKEN: READ, LEDGER_MCP_WRITE: '1' };
      expect(() => loadMcpConfig(env)).toThrow('needs LEDGER_CAPTURE_TOKEN');
      expect(() => loadMcpConfig({ ...env, LEDGER_CAPTURE_TOKEN: READ })).toThrow(
        'must be a different token',
      );
      expect(loadMcpConfig({ ...env, LEDGER_CAPTURE_TOKEN: CAPTURE })).toMatchObject({
        write: true,
        captureToken: CAPTURE,
        readToken: READ,
      });
    });

    it('ignores a capture token when write mode is off and says so', () => {
      const config = loadMcpConfig({ LEDGER_API_TOKEN: READ, LEDGER_CAPTURE_TOKEN: CAPTURE });
      expect(config.captureToken).toBeUndefined();
      expect(config.notes).toEqual([
        'LEDGER_CAPTURE_TOKEN is set but LEDGER_MCP_WRITE is not 1, so it is ignored',
      ]);
    });
  });
});
