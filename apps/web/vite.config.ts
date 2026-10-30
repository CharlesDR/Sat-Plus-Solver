import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const MODEL = fileURLToPath(new URL('../../data/generated/model.json', import.meta.url));

/** The worker loads data/generated/model.json; fail early with the fix when it is missing. */
function requireModel(): Plugin {
  return {
    name: 'sps:require-model',
    buildStart() {
      if (!existsSync(MODEL))
        this.error('data/generated/model.json is missing. Run `pnpm build:data` first.');
    },
  };
}

/** Hash of the layout code (packages/graph), so the layout cache (S3) starts fresh when it changes. */
function layoutCodeHash(): string {
  const dir = fileURLToPath(new URL('../../packages/graph/src', import.meta.url));
  const h = createHash('sha256');
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort())
    h.update(f).update(readFileSync(join(dir, f)));
  return h.digest('hex').slice(0, 12);
}

/** The build stamp shown in the File menu (R1): short commit SHA, or "local", and UTC date. */
const build = {
  sha: process.env.GITHUB_SHA?.slice(0, 7) ?? 'local',
  date: new Date().toISOString().slice(0, 10),
};

export default defineConfig({
  define: {
    __LAYOUT_CODE__: JSON.stringify(layoutCodeHash()),
    __BUILD__: JSON.stringify(build),
  },
  // Relative base so the build works under a GitHub Pages project path.
  base: './',
  plugins: [react(), requireModel()],
  // highs.mjs locates highs.wasm via import.meta.url; pre-bundling would break that in dev.
  optimizeDeps: { exclude: ['highs'] },
  worker: { format: 'es' },
  // Two pages from one build: the full planner, and simple mode at /simple/ (A72).
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        simple: resolve(import.meta.dirname, 'simple/index.html'),
      },
    },
  },
});
