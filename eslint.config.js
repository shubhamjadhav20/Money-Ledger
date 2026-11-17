// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const NODE_IO_MODULES = [
  'node:*',
  'fs',
  'fs/*',
  'path',
  'os',
  'http',
  'https',
  'net',
  'tls',
  'dns',
  'child_process',
  'worker_threads',
  'crypto',
  'process',
];

export default defineConfig([
  globalIgnores(['**/node_modules/', '**/dist/', '**/coverage/', 'packages/web/']),

  {
    files: ['**/*.js'],
    extends: [js.configs.recommended],
  },

  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // MCP uses stdio: stray stdout corrupts the protocol. Use a logger that writes to stderr.
      'no-console': 'error',
    },
  },

  // packages/core is pure: no I/O, no process/env access, no logging.
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: NODE_IO_MODULES,
              message: 'packages/core has no I/O. Pass data in, return data out.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'packages/core has no I/O.' },
        { name: 'process', message: 'packages/core has no I/O.' },
        { name: 'console', message: 'packages/core does not log.' },
      ],
    },
  },
]);
