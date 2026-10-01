import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

// Lints virtual files against the real repo config to prove the package
// dependency rule (docs/ARCHITECTURE.md §7) is enforced. The files need not exist.
const eslint = new ESLint({ cwd: new URL('..', import.meta.url).pathname });

async function restrictedImportErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === '@typescript-eslint/no-restricted-imports')
    .map((m) => m.message);
}

describe('package dependency rule', () => {
  test.each([
    ['packages/solver/src/x.ts', "import { App } from '@sps/web';\nexport { App };\n"],
    ['packages/solver/src/x.ts', "export * from '@sps/world';\n"],
    ['packages/data/src/x.ts', "export * from '@sps/solver';\n"],
    ['packages/world/src/x.ts', "export * from '@sps/graph';\n"],
    ['packages/graph/src/x.ts', "export { PACKAGE_NAME } from '@sps/solver';\n"],
    ['packages/world/src/x.ts', "import highs from 'highs';\nexport { highs };\n"],
    ['apps/web/src/x.ts', "import highs from 'highs';\nexport { highs };\n"],
    ['apps/web/src/x.ts', "export * from '@sps/data/build';\n"],
    ['packages/solver/src/x.ts', "export * from '@sps/data/build';\n"],
  ])('%s rejects: %s', async (file, code) => {
    expect(await restrictedImportErrors(file, code)).not.toHaveLength(0);
  });

  test.each([
    ['packages/solver/src/x.ts', "export * from '@sps/data';\n"],
    ['packages/world/src/x.ts', "export * from '@sps/solver';\n"],
    ['packages/graph/src/x.ts', "export type { Foo } from '@sps/solver';\n"],
    ['apps/web/src/x.ts', "export * from '@sps/world';\n"],
    ['packages/solver/src/x.ts', "import highs from 'highs';\nexport { highs };\n"],
  ])('%s allows: %s', async (file, code) => {
    expect(await restrictedImportErrors(file, code)).toHaveLength(0);
  });
});
