/**
 * Settings come from environment variables, set in the MCP client's server entry:
 *
 *   LEDGER_API_URL        where the API listens (default http://127.0.0.1:3000)
 *   LEDGER_API_TOKEN      a `read` token; every read tool uses it
 *   LEDGER_MCP_WRITE      `1` to offer add_transaction (anything else but empty or `0` is an error)
 *   LEDGER_CAPTURE_TOKEN  a `capture` token, required with LEDGER_MCP_WRITE=1 and used only by add_transaction
 *
 * Errors never include a token.
 */
export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigError';
  }
}

export interface McpConfig {
  /** No trailing slash, no path. */
  readonly apiUrl: string;
  readonly readToken: string;
  readonly write: boolean;
  readonly captureToken: string | undefined;
  /** Things worth telling the person at start-up (written to stderr). */
  readonly notes: readonly string[];
}

export const DEFAULT_API_URL = 'http://127.0.0.1:3000';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function parseApiUrl(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new McpConfigError('LEDGER_API_URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new McpConfigError('LEDGER_API_URL must start with http:// or https://');
  }
  if (url.username !== '' || url.password !== '') {
    throw new McpConfigError('LEDGER_API_URL must not contain a user name or password');
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') {
    throw new McpConfigError('LEDGER_API_URL must be just the address, with no path or query');
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    // A bearer token must not cross a network in clear text.
    throw new McpConfigError('LEDGER_API_URL must use https:// unless it points at this computer');
  }
  return url.origin;
}

function token(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name]?.trim();
  if (value === undefined || value === '') return undefined;
  if (/\s/u.test(value)) throw new McpConfigError(`${name} must not contain spaces or line breaks`);
  return value;
}

export function loadMcpConfig(env: Readonly<Record<string, string | undefined>>): McpConfig {
  const rawUrl = env['LEDGER_API_URL']?.trim();
  const apiUrl = parseApiUrl(rawUrl === undefined || rawUrl === '' ? DEFAULT_API_URL : rawUrl);
  const readToken = token(env, 'LEDGER_API_TOKEN');
  if (readToken === undefined) {
    throw new McpConfigError('LEDGER_API_TOKEN is required (a token with scope "read")');
  }

  const flag = env['LEDGER_MCP_WRITE']?.trim() ?? '';
  if (flag !== '' && flag !== '0' && flag !== '1') {
    throw new McpConfigError(
      'LEDGER_MCP_WRITE must be 1 (offer add_transaction) or 0/unset (read only)',
    );
  }
  const write = flag === '1';
  const captureToken = token(env, 'LEDGER_CAPTURE_TOKEN');
  const notes: string[] = [];

  if (write) {
    if (captureToken === undefined) {
      throw new McpConfigError(
        'LEDGER_MCP_WRITE=1 needs LEDGER_CAPTURE_TOKEN (a token with scope "capture")',
      );
    }
    if (captureToken === readToken) {
      throw new McpConfigError(
        'LEDGER_CAPTURE_TOKEN must be a different token from LEDGER_API_TOKEN, so the read tools can never write',
      );
    }
    return { apiUrl, readToken, write, captureToken, notes };
  }
  if (captureToken !== undefined) {
    notes.push('LEDGER_CAPTURE_TOKEN is set but LEDGER_MCP_WRITE is not 1, so it is ignored');
  }
  return { apiUrl, readToken, write, captureToken: undefined, notes };
}
