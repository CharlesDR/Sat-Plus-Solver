/**
 * Factory solve worker (S2): one of the solver worker's pool. Loads its own
 * model and HiGHS and solves the single-factory requests it is sent; world
 * resolution and the solve cache stay in the solver worker. Each reply
 * carries the embodied import costs it learnt since the last one (A90), so
 * the solver worker's saved caches stay whole.
 */
import type { Model } from '@sps/data';
import {
  costCacheEntries,
  createHighsBackend,
  seedCostCache,
  solve,
  type CostCacheEntry,
} from '@sps/solver';
import modelUrl from '../../../../data/generated/model.json?url';
import type { FromFactoryWorker, ToFactoryWorker } from './pool';

const post = (msg: FromFactoryWorker) => globalThis.postMessage(msg);

const ready = (async () => {
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Could not load the model (${res.status}).`);
  return { model: (await res.json()) as Model, backend: createHighsBackend() };
})();
/** Cost keys the solver worker already has: seeded, or sent back with a solve. */
const known = new Set<string>();
void ready.then(() => post({ type: 'ready' }));

globalThis.addEventListener('message', (e: MessageEvent<ToFactoryWorker>) => {
  const msg = e.data;
  void (async () => {
    try {
      const { model, backend } = await ready;
      if (msg.type === 'seed') {
        seedCostCache(model, msg.costs);
        for (const [key] of msg.costs) known.add(key);
        return;
      }
      const result = await solve(model, msg.request, backend);
      const costs: CostCacheEntry[] = costCacheEntries(model).filter(([key]) => !known.has(key));
      for (const [key] of costs) known.add(key);
      post({ type: 'solved', id: msg.id, result, costs });
    } catch (err) {
      if (msg.type === 'solve')
        post({ type: 'failed', id: msg.id, message: (err as Error).message });
    }
  })();
});
