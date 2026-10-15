/**
 * The factory solve pool (S2): up to `POOL_LIMIT` workers that run single
 * factory solves for the solver worker, which keeps world resolution and the
 * solve cache. Fewer workers on devices with fewer cores; the cap is a tuning
 * knob. Results are identical with any pool size.
 */
import type { CostCacheEntry, SolveRequest, SolveResult } from '@sps/solver';

/** Most factory solves in flight. */
export const POOL_LIMIT = 4;

export type ToFactoryWorker =
  { type: 'solve'; id: number; request: SolveRequest } | { type: 'seed'; costs: CostCacheEntry[] };
export type FromFactoryWorker =
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
  /** Sends every worker the saved import costs (A90). */
  seed(costs: CostCacheEntry[]): void;
}

/** A pool over `workers`; `onCosts` hears the import costs each solve learnt. */
export function createFactoryPool(
  workers: PoolWorker[],
  onCosts: (costs: CostCacheEntry[]) => void,
): FactoryPool {
  const idle = [...workers];
  const waiting: (() => void)[] = [];
  const pending = new Map<
    number,
    { resolve: (r: SolveResult) => void; reject: (e: Error) => void }
  >();
  let next = 0;
  for (const w of workers)
    w.addEventListener('message', ({ data }) => {
      const p = pending.get(data.id);
      pending.delete(data.id);
      idle.push(w);
      waiting.shift()?.();
      if (!p) return;
      if (data.type === 'failed') return p.reject(new Error(data.message));
      if (data.costs.length) onCosts(data.costs);
      p.resolve(data.result);
    });
  return {
    size: workers.length,
    async solve(request) {
      while (!idle.length) await new Promise<void>((r) => waiting.push(r));
      const w = idle.pop()!;
      const id = next++;
      return new Promise<SolveResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ type: 'solve', id, request });
      });
    },
    seed(costs) {
      for (const w of workers) w.postMessage({ type: 'seed', costs });
    },
  };
}
