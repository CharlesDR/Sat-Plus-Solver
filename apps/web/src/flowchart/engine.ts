/** The app's ELK engines, each running in a worker of its own (docs/ARCHITECTURE.md §8). */
import type { LayoutEngine } from '@sps/graph';
import ELK from 'elkjs/lib/elk-api.js';

/** The page's engine; its worker starts now, since the first drawing needs it. */
export function startLayoutWorker(): LayoutEngine {
  return new ELK({
    // Every layout is layered (graph layout.ts, worldLayout.ts), so the worker registers only that one.
    algorithms: ['layered'],
    workerFactory: () =>
      new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' }),
  });
}

/**
 * An engine whose worker starts on its first layout (BR-2): the solver
 * worker lays out only for Modeler export (A58), so most visits never start it.
 */
export function lazyLayoutWorker(): LayoutEngine {
  let engine: LayoutEngine | undefined;
  return { layout: (graph) => (engine ??= startLayoutWorker()).layout(graph) };
}
