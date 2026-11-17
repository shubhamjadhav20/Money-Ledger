import { describe, expect, it } from 'vitest';
import { CORE_PACKAGE } from './index.ts';

describe('@ledger/core scaffold', () => {
  it('exposes its entry point', () => {
    expect(CORE_PACKAGE).toBe('@ledger/core');
  });
});
