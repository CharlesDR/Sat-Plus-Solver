/** The app's ELK engine, running in its own worker (docs/ARCHITECTURE.md §8). */
import type { LayoutEngine } from '@sps/graph';
import ELK from 'elkjs/lib/elk-api.js';

export function startLayoutWorker(): LayoutEngine {
  return new ELK({
    workerFactory: () =>
      new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' }),
  });
}
