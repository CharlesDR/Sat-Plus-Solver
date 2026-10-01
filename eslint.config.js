// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Package dependency rule (docs/ARCHITECTURE.md §7): data ← solver ← world ← web.
 * `graph` may use solver/world *types* only. HiGHS is reachable only from `solver`.
 * Each entry lists what a package must NOT import.
 */
const HIGHS = { name: 'highs', message: 'HiGHS is reachable only through the solver LpBackend.' };
const forbid = (pkg, why) => ({ name: pkg, message: why });
const layering = 'Violates the package dependency rule (docs/ARCHITECTURE.md §7).';

/** @type {Record<string, { paths: object[]; allowTypeImports?: boolean }>} */
export const boundaries = {
  'packages/data/**': {
    paths: ['@sps/solver', '@sps/world', '@sps/graph', '@sps/web']
      .map((p) => forbid(p, layering))
      .concat(HIGHS),
  },
  'packages/solver/**': {
    paths: ['@sps/world', '@sps/graph', '@sps/web'].map((p) => forbid(p, layering)),
  },
  'packages/world/**': {
    paths: ['@sps/graph', '@sps/web'].map((p) => forbid(p, layering)).concat(HIGHS),
  },
  'apps/web/**': {
    paths: [HIGHS],
  },
};

const boundaryConfigs = Object.entries(boundaries).map(([files, { paths }]) => ({
  files: [files],
  rules: {
    '@typescript-eslint/no-restricted-imports': ['error', { paths }],
  },
}));

// graph: value imports of solver/world are forbidden, type-only imports are allowed.
const graphBoundary = {
  files: ['packages/graph/**'],
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: [
          ...['@sps/solver', '@sps/world'].map((p) => ({
            name: p,
            message: 'graph may import solver/world result types only (use `import type`).',
            allowTypeImports: true,
          })),
          ...['@sps/data', '@sps/web'].map((p) => forbid(p, layering)),
          HIGHS,
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.es2023 } },
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/data/**', 'tooling/**', '*.config.{js,ts}', '**/vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  ...boundaryConfigs,
  graphBoundary,
);
