/**
 * Main-thread side of the solver worker. Solves run one at a time; while one
 * runs, only the newest pending request is kept, so fast edits never pile up.
 */
import type { PlanSummary } from '@sps/solver';
import type { World } from '@sps/world';
import type { CatalogItem, FromWorker, ToWorker } from './protocol';

/** The part of `Worker` the client uses (a fake in tests). */
export interface WorkerLike {
  postMessage(msg: ToWorker): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<FromWorker>) => void): void;
  terminate(): void;
}

export interface SolverReady {
  catalog: CatalogItem[];
  dataHash: string;
}

export interface SolveOutcome {
  plan: PlanSummary;
  ms: number;
}

export interface SolverClient {
  ready: Promise<SolverReady>;
  /** Resolves `null` when a newer request replaced this one before it was sent. */
  solve(world: World, factoryId: string): Promise<SolveOutcome | null>;
  dispose(): void;
}

interface Pending {
  world: World;
  factoryId: string;
  resolve: (o: SolveOutcome | null) => void;
  reject: (e: Error) => void;
}

export function createSolverClient(worker: WorkerLike): SolverClient {
  let nextId = 1;
  let inFlight: (Pending & { id: number }) | undefined;
  let queued: Pending | undefined;
  let onReady!: (r: SolverReady) => void;
  let onInitError!: (e: Error) => void;
  const ready = new Promise<SolverReady>((res, rej) => {
    onReady = res;
    onInitError = rej;
  });

  const send = (p: Pending) => {
    const id = nextId++;
    inFlight = { ...p, id };
    worker.postMessage({ type: 'solve', id, world: p.world, factoryId: p.factoryId });
  };

  worker.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'ready') return onReady({ catalog: msg.catalog, dataHash: msg.dataHash });
    if (msg.type === 'init-error') return onInitError(new Error(msg.message));
    if (!inFlight || msg.id !== inFlight.id) return;
    const done = inFlight;
    inFlight = undefined;
    if (msg.type === 'solved') done.resolve({ plan: msg.plan, ms: msg.ms });
    else done.reject(new Error(msg.message));
    if (queued) {
      const next = queued;
      queued = undefined;
      send(next);
    }
  });

  return {
    ready,
    solve(world, factoryId) {
      return new Promise((resolve, reject) => {
        const p: Pending = { world, factoryId, resolve, reject };
        if (!inFlight) return send(p);
        queued?.resolve(null);
        queued = p;
      });
    },
    dispose() {
      worker.terminate();
      queued?.resolve(null);
      inFlight?.resolve(null);
      queued = inFlight = undefined;
    },
  };
}

/** The app's worker. */
export function startSolverWorker(): SolverClient {
  const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  return createSolverClient(worker as WorkerLike);
}
