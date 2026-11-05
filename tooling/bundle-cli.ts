/**
 * `pnpm cli:bundle [outDir]`: bundles tooling/cli.ts into `<outDir>/sps.mjs`
 * (default `dist-cli`) with every mod version's model in `models/<version>/`
 * (from `pnpm build:data`, A111) and `highs.wasm` beside it. CI builds it on every merge to main; the build
 * thread copies it to the project files (scenario tooling).
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { generatedDir, modVersions, ROOT } from './build-data';

const out = resolve(process.argv[2] ?? join(ROOT, 'dist-cli'));
const models = modVersions().map((v) => ({
  version: v,
  file: join(generatedDir(v), 'model.json'),
}));
for (const { version, file } of models)
  if (!existsSync(file))
    throw new Error(
      `Run \`pnpm build:data\` first: data/generated/${version}/model.json is missing.`,
    );
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(ROOT, 'tooling', 'cli.ts')],
  outfile: join(out, 'sps.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  define: { 'process.env.SPS_CLI_BUNDLE': '"1"' },
  // Bundled CommonJS dependencies (HiGHS) call require.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
const highs = createRequire(join(ROOT, 'packages', 'solver', 'package.json')).resolve('highs');
copyFileSync(join(dirname(highs), 'highs.wasm'), join(out, 'highs.wasm'));
rmSync(join(out, 'models'), { recursive: true, force: true });
for (const { version, file } of models) {
  mkdirSync(join(out, 'models', version), { recursive: true });
  copyFileSync(file, join(out, 'models', version, 'model.json'));
}
writeFileSync(
  join(out, 'README.md'),
  'Prebuilt Sat-Plus-Solver CLI. `node sps.mjs solve …` or `node sps.mjs world solve <world.json | share link | -> --summary`.\n' +
    'A world solves on its own mod version; `--mod-version <version>` picks another (models/ lists them).\n' +
    'Rebuild with `pnpm build:data && pnpm cli:bundle <dir>` from the repo.\n',
);
console.log(`CLI bundle written to ${out}`);
