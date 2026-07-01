import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import { defineConfig, globalIgnores } from 'eslint/config';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import prettier from 'eslint-plugin-prettier/recommended';
import react from 'eslint-plugin-react';
import reactDoctor from 'eslint-plugin-react-doctor';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

const eslintConfig = defineConfig([
  globalIgnores(['dist/**', 'dist-electron/**', 'release/**', 'node_modules/**']),
  {
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      eslintReact.configs['recommended-typescript'],
      reactDoctor.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactYouMightNotNeedAnEffect.configs.strict,
      reactRefresh.configs.vite,
      prettier,
      betterTailwind.configs['recommended-error'],
    ],
    plugins: {
      react,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'no-alert': 'error',
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'prefer-const': 'error',
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': 'error',
      'react-doctor/react-compiler-no-manual-memoization': 'off',
      'better-tailwindcss/enforce-consistent-line-wrapping': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message: 'Use @/... aliases instead of ../ imports.',
            },
          ],
        },
      ],
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'src/index.css',
      },
      react: {
        version: '19',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      'react/self-closing-comp': 'error',
    },
  },
  {
    files: ['scripts/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/components/ui/*.{ts,tsx,mts,cts}'],
    rules: {
      'react-doctor/no-multi-comp': 'off',
    },
  },
]);

export default eslintConfig;
