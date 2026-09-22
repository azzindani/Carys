// Lint config. The point is not style — it is the bug classes that the
// project's existing gates structurally cannot see. Golden hashes pin render
// math, the wire suite pins user flows, and `verify.test.ts` pins
// architecture; none of them can see an un-awaited promise or a value that
// silently became `any` on the way through a decoder.
//
// So: type-aware rules only where they earn it, `--max-warnings 0` in the
// script (a warning nobody must fix is a warning nobody reads), and one rule
// that makes an already-written standard checkable — §26's TODO/FIXME ban was
// prose until now.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // Build output, vendored fixtures and generated trees are not source.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'packages/ui/**',
      'samples/**',
      'digests/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // --- the bug classes the other gates cannot reach
      // node:test's describe/it return promises the runner owns; awaiting
      // them is wrong. Naming them keeps the rule live inside test bodies,
      // where a dropped await is just as much a bug as in src.
      '@typescript-eslint/no-floating-promises': ['error', {
        allowForKnownSafeCalls: [
          { from: 'package', package: 'node:test', name: ['describe', 'it', 'test', 'suite'] },
        ],
      }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // --- §26: the ledger owns the future, not a comment in the source.
      // Exactly the two terms the standard names, and only as a marker at the
      // start of a comment: 'anywhere' matched a mask diagram drawn in Xs and
      // a sentence that happened to contain the word.
      'no-warning-comments': ['error', { terms: ['todo', 'fixme'], location: 'start' }],

      // --- ordinary correctness
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none',
      }],

      // --- deliberately off, with a reason
      // require-await: `async` here is how a function satisfies a
      // Promise-returning contract it did not write — the FetchFn mocks, the
      // provider registry's `get`, an export that returns early. All 28 hits
      // were that shape and none was a bug, so the rule only taught people to
      // scatter pointless awaits.
      '@typescript-eslint/require-await': 'off',
      // Non-null assertions are how the numeric code reads a typed array it
      // has already bounds-checked; banning them would trade a real check for
      // a `?? 0` that hides the bug instead.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // The React app: these disable comments were already in the source with
    // no plugin behind them, so every one of them was decoration.
    files: ['packages/app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    // Tests build hostile input on purpose and reach into internals.
    files: ['**/test/**/*.ts', 'test/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
);
