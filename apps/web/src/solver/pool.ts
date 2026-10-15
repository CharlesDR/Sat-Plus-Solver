/**
 * The factory solve pool (S2): up to `POOL_LIMIT` workers that run single
 * factory solves for the solver worker, which keeps world resolution and the
 * solve cache. Fewer workers on devices with fewer cores; the cap is a tuning
 * knob. Results are identical with any pool size. Until a worker has loaded
 * its model, solves run in the solver worker itself, so a cold start is no
 * slower than with no pool.
 */
import type { CostCacheEntry, SolveRequest, SolveResult } from '@sps/solver';

/** Most factory solves in flight. */
export const POOL_LIMIT = 4;

export type ToFactoryWorker =
  { type: 'solve'; id: number; request: SolveRequest } | { type: 'seed'; costs: CostCacheEntry[] };
export type FromFactoryWorker =
  | { type: 'ready' }
  | { type: 'solved'; id: number; result: SolveResult; costs: CostCacheEntry[] }
  | { type: 'failed'; id: number; message: string };

/** Pool size for a device: one core stays with the solver worker, at most `POOL_LIMIT`. */
export function poolSize(cores: number | undefined): number {
  return Math.max(1, Math.min(POOL_LIMIT, (cores ?? 2) - 1));
}

/** Something a pool can post to: a Worker, or a stand-in in tests. */
export interface PoolWorker {
  postMessage(msg: ToFactoryWorker): void;
  addEventListener(type: 'message', listener: (e: { data: FromFactoryWorker }) => void): void;
}

export interface FactoryPool {
  size: number;
  solve(request: SolveRequest): Promise<SolveResult>;
  /** Starts the workers, once: for a world with factories that can solve at once. */
  warm(): void;
}

export interface PoolOptions {
  /** How many workers `spawn` makes. */
  size: number;
  /** Makes the workers; called by the first `warm`. */
  spawn(): PoolWorker[];
  /** Hears the import costs each solve learnt (A90). */
  onCosts(costs: CostCacheEntry[]): void;
  /** The solver worker's import costs, sent to new workers (A90). */
  costs(): CostCacheEntry[];
  /** Solves while no worker is ready yet. */
  local(request: SolveRequest): Promise<SolveResult>;
}

/**
 * A pool of factory solve workers, started only when a world has more than
 * one factory, so a one-factory session pays nothing for it.
 */
export function createFactoryPool(options: PoolOptions): FactoryPool {
  const { onCosts, local } = options;
  let workers: PoolWorker[] = [];
  const idle: PoolWorker[] = [];
  let ready = 0;
  const waiting: (() => void)[] = [];
  const pending = new Map<
    number,
    { resolve: (r: SolveResult) => void; reject: (e: Error) => void }
  >();
  let next = 0;
  const listen = (w: PoolWorker) =>
    w.addEventListener('message', ({ data }) => {
      if (data.type === 'ready') {
        ready++;
        idle.push(w);
        waiting.shift()?.();
        return;
      }
      const p = pending.get(data.id);
      pending.delete(data.id);
      idle.push(w);
      waiting.shift()?.();
      if (!p) return;
      if (data.type === 'failed') return p.reject(new Error(data.message));
      if (data.costs.length) {
        onCosts(data.costs);
        // The other workers learn them too, so no worker costs an import twice (A90).
        for (const o of workers) if (o !== w) o.postMessage({ type: 'seed', costs: data.costs });
      }
      p.resolve(data.result);
    });
  return {
    size: options.size,
    warm() {
      if (workers.length) return;
      workers = options.spawn();
      const costs = options.costs();
      for (const w of workers) {
        listen(w);
        if (costs.length) w.postMessage({ type: 'seed', costs });
      }
    },
    async solve(request) {
      if (!ready) return local(request);
      while (!idle.length) await new Promise<void>((r) => waiting.push(r));
      const w = idle.pop()!;
      const id = next++;
      return new Promise<SolveResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ type: 'solve', id, request });
      });
    },
  };
}
