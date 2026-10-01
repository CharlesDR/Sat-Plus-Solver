/**
 * Solver worker: loads the model and HiGHS off the main thread and answers
 * solve requests one at a time (CLAUDE.md: the main thread never runs the LP).
 */
import type { Model } from '@sps/data';
import { createHighsBackend } from '@sps/solver';
import modelUrl from '../../../../data/generated/model.json?url';
import type { FromWorker, ToWorker } from './protocol';
import { createSolverService, type SolverService } from './service';

const post = (msg: FromWorker) => globalThis.postMessage(msg);

async function init(): Promise<SolverService> {
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Could not load the model (${res.status}).`);
  const model = (await res.json()) as Model;
  // highs.mjs finds highs.wasm next to itself; the bundler emits it as an asset.
  return createSolverService(model, createHighsBackend());
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
      const { plan, graph } = await s.solve(msg.world, msg.factoryId);
      post({ type: 'solved', id: msg.id, plan, graph, ms: performance.now() - t0 });
    } catch (err) {
      post({ type: 'failed', id: msg.id, message: (err as Error).message });
    }
  });
});
