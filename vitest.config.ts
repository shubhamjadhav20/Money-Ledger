import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Definition of done: core money logic is >= 90% line-covered (PLAN.md section 11).
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        lines: 90,
        branches: 85,
      },
    },
  },
});
