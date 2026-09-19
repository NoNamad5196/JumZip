import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  { ignores: ['node_modules/**', 'dist/**', 'references/**', 'supabase/.temp/**', 'test-results/**', 'tests/ui/artifacts/**', 'coverage/**'] },
  {
    files: ['**/*.{ts,tsx,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // JSON stored by Supabase and isolated test doubles are validated at runtime.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
]);
