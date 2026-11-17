import { describe, expect, it } from 'vitest';
import { TOOLS_DEPENDS_ON } from './index.ts';

describe('@ledger/tools scaffold', () => {
  it('resolves @ledger/core through the workspace', () => {
    expect(TOOLS_DEPENDS_ON).toEqual(['@ledger/core']);
  });
});
