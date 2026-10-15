/**
 * `pnpm measure:parallel [workers]`: times cold world solves with factory
 * solves run one at a time and on a pool of worker threads (S2), on the
 * sample world, a wide world (eight short chains and six standalone
 * factories) and a long-chain world (one twelve-factory pull chain beside
 * four wide factories), and checks the results are identical.
 */
import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import type { Model } from '@sps/data';
import { createHighsBackend, solve, type SolveRequest, type SolveResult } from '@sps/solver';
import {
  createFactory,
  createWorld,
  migrateWorld,
  resolveWorld,
  type Link,
  type SolveFactory,
  type World,
} from '@sps/world';
import { ROOT } from './build-data';
import { loadModel } from './solve';

type Spec = { id: string; targets?: { item: string; rate: number }[] };

function world(model: Model, specs: Spec[], links: Link[]): World {
  const w = createWorld(model.meta.dataHash);
  w.factories = specs.map((s) => {
    const f = createFactory(s.id, s.id);
    f.request = { targets: s.targets ?? [] };
    return f;
  });
  w.links = links;
  return w;
}

const pull = (id: string, from: string, to: string, item: string): Link => ({
  id,
  from,
  to,
  item,
  mode: { kind: 'pull' },
});

/** The worlds measured. */
export function worlds(model: Model): { name: string; world: World }[] {
  const products = ['iron-plate', 'reinforced-iron-plate', 'modular-frame', 'steel-beam'];
  const wide: Spec[] = [];
  const wideLinks: Link[] = [];
  for (let c = 0; c < 8; c++) {
    wide.push(
      { id: `c${c}-raw` },
      { id: `c${c}-mid` },
      { id: `c${c}-end`, targets: [{ item: products[c % 4]!, rate: 10 + 5 * c }] },
    );
    wideLinks.push(
      pull(`c${c}-a`, `c${c}-raw`, `c${c}-mid`, 'iron-ingot'),
      pull(`c${c}-b`, `c${c}-mid`, `c${c}-end`, 'iron-plate'),
    );
  }
  for (const [id, item, rate] of [
    ['solo-a', 'motor', 2],
    ['solo-b', 'plastic', 30],
    ['solo-c', 'rotor', 5],
    ['solo-d', 'computer', 1],
    ['solo-e', 'stator', 5],
    ['solo-f', 'circuit-board', 5],
  ] as const)
    wide.push({ id, targets: [{ item, rate }] });
  // A long line reaching back: each factory makes plates and passes ingots on.
  const chain: Spec[] = [];
  const chainLinks: Link[] = [];
  for (let k = 0; k < 12; k++) {
    chain.push({
      id: `l${String(k).padStart(2, '0')}`,
      targets: [{ item: 'iron-plate', rate: 10 }],
    });
    if (k > 0)
      chainLinks.push(
        pull(
          `l${k}`,
          `l${String(k).padStart(2, '0')}`,
          `l${String(k - 1).padStart(2, '0')}`,
          'iron-ingot',
        ),
      );
  }
  for (const [id, item, rate] of [
    ['solo-a', 'motor', 2],
    ['solo-b', 'plastic', 30],
    ['solo-c', 'computer', 1],
    ['solo-d', 'stator', 5],
  ] as const)
    chain.push({ id, targets: [{ item, rate }] });
  const sample = migrateWorld(
    JSON.parse(readFileSync(join(ROOT, 'examples', 'world.json'), 'utf8')),
  );
  return [
    { name: 'sample', world: sample },
    { name: 'wide (30)', world: world(model, wide, wideLinks) },
    { name: 'long chain (16)', world: world(model, chain, chainLinks) },
  ];
}

/** A pool of worker threads, each with its own model and HiGHS (S2). */
function pool(size: number): { solveFactory: SolveFactory; close: () => Promise<void> } {
  const workers = Array.from(
    { length: size },
    () => new Worker(new URL('./parallel-worker.mjs', import.meta.url)),
  );
  const idle = [...workers];
  const queue: (() => void)[] = [];
  let next = 0;
  const pending = new Map<number, (r: SolveResult) => void>();
  for (const w of workers)
    w.on('message', ({ id, result }: { id: number; result: SolveResult }) => {
      pending.get(id)!(result);
      pending.delete(id);
      idle.push(w);
      queue.shift()?.();
    });
  const solveFactory: SolveFactory = async (request) => {
    if (!idle.length) await new Promise<void>((r) => queue.push(r));
    const w = idle.pop()!;
    const id = next++;
    return new Promise<SolveResult>((resolve) => {
      pending.set(id, resolve);
      w.postMessage({ id, request });
    });
  };
  return {
    solveFactory,
    close: async () => void (await Promise.all(workers.map((w) => w.terminate()))),
  };
}

/** Worker side: solves each request it is sent. */
async function serve(): Promise<void> {
  const model = await loadModel();
  const backend = createHighsBackend();
  parentPort!.on('message', async ({ id, request }: { id: number; request: SolveRequest }) => {
    parentPort!.postMessage({ id, result: await solve(model, request, backend) });
  });
}

/** Infinity survives the trip to and from workers as JSON can't; compare structurally. */
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a, (k, v: unknown) => (k === 'stats' ? undefined : v === Infinity ? 'Inf' : v)) ===
  JSON.stringify(b, (k, v: unknown) => (k === 'stats' ? undefined : v === Infinity ? 'Inf' : v));

async function main(): Promise<void> {
  const size = Number(process.argv[2] ?? Math.min(4, availableParallelism()));
  const model = await loadModel();
  const backend = createHighsBackend();
  const serial: SolveFactory = (r) => solve(model, r, backend);
  const p = pool(size);
  // Warm both: load HiGHS in every worker and in this thread.
  await Promise.all(
    Array.from({ length: size }, () =>
      p.solveFactory({ targets: [{ item: 'iron-plate', rate: 1 }] }),
    ),
  );
  await serial({ targets: [{ item: 'iron-plate', rate: 1 }] });
  console.log(`Cold world solves, ${size} workers (median of 3):`);
  for (const { name, world: w } of worlds(model)) {
    const time = async (f: SolveFactory, concurrency: number) => {
      const runs: number[] = [];
      let result;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        result = await resolveWorld(w, model, f, undefined, { concurrency });
        runs.push(performance.now() - t0);
      }
      return { ms: runs.sort((a, b) => a - b)[1]!, result };
    };
    const one = await time(serial, 1);
    const many = await time(p.solveFactory, size);
    console.log(
      `  ${name.padEnd(16)} 1 at a time ${one.ms.toFixed(0).padStart(6)} ms   pool ${many.ms
        .toFixed(0)
        .padStart(
          6,
        )} ms   ${(one.ms / many.ms).toFixed(2)}×   identical: ${same(one.result, many.result)}`,
    );
  }
  await p.close();
}

if (!isMainThread) await serve();
else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
