import { describe, expect, it } from 'vitest';
import { API_DEPENDS_ON } from './index.ts';

describe('@ledger/api scaffold', () => {
  it('resolves @ledger/core through the workspace', () => {
    expect(API_DEPENDS_ON).toEqual(['@ledger/core']);
  });
});
