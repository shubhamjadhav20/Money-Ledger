/**
 * @ledger/mcp: local stdio MCP server, built in M6.
 * Never write to stdout (it carries the protocol); log to stderr only.
 */
import { TOOLS_DEPENDS_ON } from '@ledger/tools';

export const MCP_DEPENDS_ON = ['@ledger/tools', ...TOOLS_DEPENDS_ON] as const;
