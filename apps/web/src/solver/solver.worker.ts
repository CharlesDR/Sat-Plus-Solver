/**
 * Solver worker: loads the model and HiGHS off the main thread and answers
 * world solve requests one at a time (CLAUDE.md: the main thread never runs the LP).
 */
import { createHighsBackend, createSolver } from '@sps/solver';
import { lazyLayoutWorker } from '../flowchart/engine';
import { loadCaches, saveCaches } from './cacheStore';
import { createFactoryPool, poolSize } from './pool';
import type { FromWorker, ToWorker } from './protocol';
import { createSolverService, type SolverService } from './service';
import { loadModel } from './versions';

const post = (msg: FromWorker) => globalThis.postMessage(msg);

/** Loads one SF+ mod version's model (A111); the client names it first. */
async function init(version: string): Promise<SolverService> {
  const model = (await loadModel(version))!;
  // highs.mjs finds highs.wasm next to itself; the bundler emits it as an asset.
  // ELK lays out flowcharts for the Modeler export (A58), in a worker of its
  // own that starts on the first export (BR-2).
  const layout = lazyLayoutWorker();
  // S2: factory solves run on a pool of workers when the device has the cores.
  const size = poolSize(globalThis.navigator?.hardwareConcurrency);
  const solver = createSolver(model, createHighsBackend());
  const pool =
    size > 1
      ? createFactoryPool({
          size,
          spawn: () =>
            Array.from({ length: size }, () => {
              const w = new Worker(new URL('./factory.worker.ts', import.meta.url), {
                type: 'module',
              });
              w.postMessage({ type: 'init', version });
              return w;
            }),
          onCosts: (costs) => solver.seedCosts(costs),
          costs: () => solver.costEntries(),
          local: (request) => solver.solve(request),
        })
      : undefined;
  // A version switch reads the world's old model once, to compare (A111).
  const service = createSolverService(solver, layout, pool, loadModel);
  // Solves and import costs from the last visit with this version's data (A90).
  const saved = await loadCaches(version, service.dataHash);
  if (saved) service.seed(saved);
  return service;
}

/** Saves the caches a moment after the last solve, so a burst of solves saves once. */
let saving: ReturnType<typeof setTimeout> | undefined;
const SAVE_DELAY_MS = 2000;
function scheduleSave(version: string, s: SolverService) {
  if (saving !== undefined) clearTimeout(saving);
  saving = setTimeout(() => {
    saving = undefined;
    void saveCaches(version, s.snapshot());
  }, SAVE_DELAY_MS);
}

let start!: (version: string) => void;
const versionOf = new Promise<string>((resolve) => (start = resolve));
const service = versionOf.then(init).then(
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
  if (msg.type === 'init') return start(msg.version);
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
      scheduleSave(await versionOf, s);
    } catch (err) {
      post({ type: 'failed', id: msg.id, message: (err as Error).message });
    }
  });
});
