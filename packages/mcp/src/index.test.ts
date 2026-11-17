import { describe, expect, it } from 'vitest';
import { MCP_DEPENDS_ON } from './index.ts';

describe('@ledger/mcp scaffold', () => {
  it('resolves @ledger/tools (and transitively core) through the workspace', () => {
    expect(MCP_DEPENDS_ON).toEqual(['@ledger/tools', '@ledger/core']);
  });
});
