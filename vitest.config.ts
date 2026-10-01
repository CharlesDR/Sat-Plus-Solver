import { defineConfig } from 'vitest/config';

/**
 * Test files with wall-clock budgets (PLAN M2, M5, M7) run in their own group,
 * after every other file and one at a time, so a timing reflects the code
 * under test, not how many other test files share the CPU.
 */
const TIMED = ['tooling/solve.test.ts', 'tooling/world.test.ts', 'tooling/flowchart.test.ts'];

export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['{packages,apps}/*/src/**/*.test.{ts,tsx}', 'tooling/**/*.test.ts'],
          exclude: TIMED,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'timed',
          include: TIMED,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
