/**
 * `pnpm cli:bundle [outDir]`: bundles tooling/cli.ts into `<outDir>/sps.mjs`
 * (default `dist-cli`) with `model.json` (from `pnpm build:data`) and
 * `highs.wasm` beside it. CI builds it on every merge to main; the build
 * thread copies it to the project files (scenario tooling).
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { ROOT } from './build-data';

const out = resolve(process.argv[2] ?? join(ROOT, 'dist-cli'));
const model = join(ROOT, 'data', 'generated', 'model.json');
if (!existsSync(model))
  throw new Error('Run `pnpm build:data` first: data/generated/model.json is missing.');
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
copyFileSync(model, join(out, 'model.json'));
writeFileSync(
  join(out, 'README.md'),
  'Prebuilt Sat-Plus-Solver CLI. `node sps.mjs solve …` or `node sps.mjs world solve <world.json | share link | -> --summary`.\n' +
    'Rebuild with `pnpm build:data && pnpm cli:bundle <dir>` from the repo.\n',
);
console.log(`CLI bundle written to ${out}`);
