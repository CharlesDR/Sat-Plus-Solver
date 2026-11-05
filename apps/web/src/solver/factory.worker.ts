/**
 * Factory solve worker (S2): one of the solver worker's pool. Loads its own
 * model and HiGHS and solves the single-factory requests it is sent; world
 * resolution and the solve cache stay in the solver worker. Each reply
 * carries the embodied import costs it learnt since the last one (A90), so
 * the solver worker's saved caches stay whole.
 */
import { createHighsBackend, createSolver, type CostCacheEntry } from '@sps/solver';
import type { FromFactoryWorker, ToFactoryWorker } from './pool';
import { loadModel } from './versions';

const post = (msg: FromFactoryWorker) => globalThis.postMessage(msg);

/** The solver worker names the SF+ mod version first (A111). */
let start!: (version: string) => void;
const ready = new Promise<string>((resolve) => (start = resolve)).then(async (version) =>
  createSolver((await loadModel(version))!, createHighsBackend()),
);
/** Cost keys the solver worker already has: seeded, or sent back with a solve. */
const known = new Set<string>();
void ready.then(() => post({ type: 'ready' }));

globalThis.addEventListener('message', (e: MessageEvent<ToFactoryWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') return start(msg.version);
  void (async () => {
    try {
      const solver = await ready;
      if (msg.type === 'seed') {
        solver.seedCosts(msg.costs);
        for (const [key] of msg.costs) known.add(key);
        return;
      }
      const result = await solver.solve(msg.request);
      const costs: CostCacheEntry[] = solver.costEntries().filter(([key]) => !known.has(key));
      for (const [key] of costs) known.add(key);
      post({ type: 'solved', id: msg.id, result, costs });
    } catch (err) {
      if (msg.type === 'solve')
        post({ type: 'failed', id: msg.id, message: (err as Error).message });
    }
  })();
});
