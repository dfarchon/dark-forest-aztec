import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import prettierConfig from 'eslint-config-prettier';

export default defineConfig([
  globalIgnores(['dist', 'target']),
  {
    files: ['scripts/**/*.{ts,tsx,js,jsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      prettierConfig, // Disable ESLint rules that conflict with Prettier
    ],
    languageOptions: {
      ecmaVersion: 2020,
      parserOptions: {
        sourceType: 'module',
      },
      globals: globals.node,
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
]);