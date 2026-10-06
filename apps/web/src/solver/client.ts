/**
 * Main-thread side of the solver worker. World solves run one at a time; while one
 * runs, only the newest pending request is kept, so fast edits never pile up.
 */
import type {
  Catalog,
  FromWorker,
  SolveProgress,
  ToWorker,
  WorldSolved,
  WorldSolveRequest,
} from './protocol';

/** The part of `Worker` the client uses (a fake in tests). */
export interface WorkerLike {
  postMessage(msg: ToWorker): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<FromWorker>) => void): void;
  /** The worker crashed (an uncaught error, or its script failed to load). */
  addEventListener(type: 'error', fn: (e: { message?: string }) => void): void;
  terminate(): void;
}

export interface SolverReady {
  catalog: Catalog;
  dataHash: string;
}

/** A solved world (the focused plan's flowchart is not yet laid out) and how long it took. */
export interface SolveOutcome extends WorldSolved {
  ms: number;
}

export interface SolverClient {
  ready: Promise<SolverReady>;
  /**
   * Resolves `null` when a newer request replaced this one before it was sent.
   * `onProgress` hears each factory the worker starts on (M10).
   */
  solve(
    request: WorldSolveRequest,
    onProgress?: (p: SolveProgress) => void,
  ): Promise<SolveOutcome | null>;
  dispose(): void;
}

interface Pending {
  request: WorldSolveRequest;
  onProgress?: ((p: SolveProgress) => void) | undefined;
  resolve: (o: SolveOutcome | null) => void;
  reject: (e: Error) => void;
}

export function createSolverClient(worker: WorkerLike): SolverClient {
  let nextId = 1;
  let inFlight: (Pending & { id: number }) | undefined;
  let queued: Pending | undefined;
  let onReady!: (r: SolverReady) => void;
  let onInitError!: (e: Error) => void;
  /** Set once the worker has crashed: every later solve fails with it. */
  let crashed: Error | undefined;
  const ready = new Promise<SolverReady>((res, rej) => {
    onReady = res;
    onInitError = rej;
  });

  const send = (p: Pending) => {
    const id = nextId++;
    inFlight = { ...p, id };
    const { world, focus, action } = p.request;
    worker.postMessage({
      type: 'solve',
      id,
      world,
      ...(focus !== undefined ? { focus } : {}),
      ...(action !== undefined ? { action } : {}),
    });
  };

  worker.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.type === 'ready') return onReady({ catalog: msg.catalog, dataHash: msg.dataHash });
    if (msg.type === 'init-error') return onInitError(new Error(msg.message));
    if (!inFlight || msg.id !== inFlight.id) return;
    if (msg.type === 'progress') return inFlight.onProgress?.(msg.progress);
    const done = inFlight;
    inFlight = undefined;
    if (msg.type === 'solved') {
      done.resolve({
        world: msg.world,
        ms: msg.ms,
        ...(msg.focus ? { focus: msg.focus } : {}),
        ...(msg.edited ? { edited: msg.edited } : {}),
        ...(msg.previews ? { previews: msg.previews } : {}),
      });
    } else done.reject(new Error(msg.message));
    if (queued) {
      const next = queued;
      queued = undefined;
      send(next);
    }
  });

  worker.addEventListener('error', (e) => {
    crashed = new Error(`The solver stopped unexpectedly${e.message ? `: ${e.message}` : '.'}`);
    onInitError(crashed);
    inFlight?.reject(crashed);
    queued?.reject(crashed);
    inFlight = queued = undefined;
  });

  return {
    ready,
    solve(request, onProgress) {
      return new Promise((resolve, reject) => {
        if (crashed) return reject(crashed);
        const p: Pending = { request, onProgress, resolve, reject };
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
