/**
 * Solver worker: loads the model and HiGHS off the main thread and answers
 * world solve requests one at a time (CLAUDE.md: the main thread never runs the LP).
 */
import type { Model } from '@sps/data';
import { createHighsBackend, seedCostCache } from '@sps/solver';
import ELK from 'elkjs/lib/elk-api.js';
import modelUrl from '../../../../data/generated/model.json?url';
import { loadCaches, saveCaches } from './cacheStore';
import { createFactoryPool, poolSize } from './pool';
import type { FromWorker, ToWorker } from './protocol';
import { createSolverService, type SolverService } from './service';

const post = (msg: FromWorker) => globalThis.postMessage(msg);

async function init(): Promise<SolverService> {
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Could not load the model (${res.status}).`);
  const model = (await res.json()) as Model;
  // highs.mjs finds highs.wasm next to itself; the bundler emits it as an asset.
  // ELK lays out flowcharts for the Modeler export (A58), in a worker of its own.
  const layout = new ELK({
    workerFactory: () =>
      new Worker(new URL('../flowchart/layout.worker.ts', import.meta.url), { type: 'module' }),
  });
  // S2: factory solves run on a pool of workers when the device has the cores.
  const size = poolSize(globalThis.navigator?.hardwareConcurrency);
  const pool =
    size > 1
      ? createFactoryPool(
          Array.from(
            { length: size },
            () => new Worker(new URL('./factory.worker.ts', import.meta.url), { type: 'module' }),
          ),
          (costs) => seedCostCache(model, costs),
        )
      : undefined;
  const service = createSolverService(model, createHighsBackend(), layout, pool);
  // Solves and import costs from the last visit with this data (A90).
  const saved = await loadCaches(service.dataHash);
  if (saved) service.seed(saved);
  return service;
}

/** Saves the caches a moment after the last solve, so a burst of solves saves once. */
let saving: ReturnType<typeof setTimeout> | undefined;
const SAVE_DELAY_MS = 2000;
function scheduleSave(s: SolverService) {
  if (saving !== undefined) clearTimeout(saving);
  saving = setTimeout(() => {
    saving = undefined;
    void saveCaches(s.snapshot());
  }, SAVE_DELAY_MS);
}

const service = init().then(
  (s) => {
    post({ type: 'ready', catalog: s.catalog, dataHash: s.dataHash });
    return s;
  },
  (e: unknown) => {
    post({ type: 'init-error', message: (e as Error).message });
    return undefined;
  },
);

// Requests are handled in arrival order; the client keeps at most one queued.
let chain: Promise<unknown> = Promise.resolve();
globalThis.addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  chain = chain.then(async () => {
    const s = await service;
    if (!s) return post({ type: 'failed', id: msg.id, message: 'The solver failed to start.' });
    const t0 = performance.now();
    try {
      const solved = await s.solve(
        { world: msg.world, focus: msg.focus, action: msg.action },
        (progress) => post({ type: 'progress', id: msg.id, progress }),
      );
      post({ type: 'solved', id: msg.id, ...solved, ms: performance.now() - t0 });
      scheduleSave(s);
    } catch (err) {
      post({ type: 'failed', id: msg.id, message: (err as Error).message });
    }
  });
});
