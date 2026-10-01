import { existsSync } from 'node:fs';
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

export default defineConfig({
  // Relative base so the build works under a GitHub Pages project path.
  base: './',
  plugins: [react(), requireModel()],
  // highs.mjs locates highs.wasm via import.meta.url; pre-bundling would break that in dev.
  optimizeDeps: { exclude: ['highs'] },
  worker: { format: 'es' },
});
