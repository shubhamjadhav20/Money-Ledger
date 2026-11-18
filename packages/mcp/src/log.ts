/**
 * Logging for the MCP server. stdout carries the protocol, so everything goes to stderr, and only
 * fixed words, tool names and error codes are ever logged: never memos, counterparties, message
 * bodies, amounts or tokens.
 */
export type Log = (message: string) => void;

export function stderrLog(
  write: (text: string) => unknown = (text) => process.stderr.write(text),
): Log {
  return (message) => {
    write(`ledger-mcp: ${message}\n`);
  };
}
