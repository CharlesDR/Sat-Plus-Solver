/**
 * Every part solves (Charles 2026-10-12): a fresh world with all alternates
 * on, Avoid fluid byproducts off, no max tier and the map node pool, one
 * factory per part, targeting 1/min of every item some recipe outputs (MW
 * aside). `pnpm test` checks a seeded sample (all-parts.test.ts);
 *
 *   pnpm test:all-parts      every part, in parallel workers (final validation of a build plan)
 *   pnpm scarcity-sweep      every part under O1; prints the likely-usage seed for
 *                            data/scarcity-usage.json (A85)
 */
import { execSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { MW_ITEM_ID, type Model } from '@sps/data';
import { createHighsBackend, solve, type ObjectiveId, type SolveRequest } from '@sps/solver';
import { createWorld, factorySolveRequest } from '@sps/world';
import { runPipeline } from './build-data';

/**
 * Known dataset gaps, never targeted. Only items game_data.json gives no way
 * to make belong here.
 */
export const KNOWN_GAPS: Readonly<Record<string, string>> = {
  'raw-sludge': 'No source recipe in game_data.json, only packing and unpacking.',
  'packaged-raw-sludge': 'Made only by packing Raw Sludge, which has no source recipe.',
};

/** Every item some recipe outputs, MW and known gaps aside, sorted by id. */
export function partTargets(model: Model): string[] {
  const made = new Set(model.recipes.flatMap((r) => r.outputs.map((o) => o.item)));
  return [...made].filter((i) => i !== MW_ITEM_ID && !(i in KNOWN_GAPS)).sort();
}

/** The least-restrictive request for 1/min of `item`, as a fresh world plans it. */
export function partRequest(model: Model, item: string, objectives?: ObjectiveId[]): SolveRequest {
  const world = createWorld();
  world.defaults.alternates = true;
  world.defaults.avoidFluidByproducts = false;
  if (objectives) world.defaults.objectives = objectives;
  world.factories[0]!.request.targets = [{ item, rate: 1 }];
  return factorySolveRequest(world, model, world.factories[0]!.id);
}

/** The sample seed: `SPS_PART_SEED`, else the commit SHA, so a run is reproducible. */
export function partSeed(): string {
  const env = process.env.SPS_PART_SEED ?? process.env.GITHUB_SHA;
  if (env) return env;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'no-commit';
  }
}

/** `n` items of `list`, by a shuffle seeded with `seed` (FNV-1a into mulberry32). */
export function seededSample<T>(list: readonly T[], n: number, seed: string): T[] {
  let h = 0x811c9dc5;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 0x01000193);
  let a = h >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const out = [...list];
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1));
    [out[k], out[j]] = [out[j]!, out[k]!];
  }
  return out.slice(0, n);
}

export interface PartResult {
  item: string;
  status: string;
  /** Error diagnostics, by message. */
  errors: string[];
  /** NNE drawn per node resource. */
  nne: Record<string, number>;
}

/** Solves 1/min of `item` and reports what failed and what the plan draws. */
export async function solvePart(
  model: Model,
  item: string,
  objectives?: ObjectiveId[],
  backend = createHighsBackend(),
): Promise<PartResult> {
  const r = await solve(model, partRequest(model, item, objectives), backend);
  const resource = new Map(model.nodes.map((n) => [n.id, n.resource]));
  const nne: Record<string, number> = {};
  for (const n of r.nodes) {
    const res = resource.get(n.node) ?? n.node;
    nne[res] = (nne[res] ?? 0) + n.nne;
  }
  const errors = r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
  return { item, status: r.status, errors, nne };
}

interface Job {
  model: Model;
  items: string[];
  objectives?: ObjectiveId[];
}

/** Solves every item across worker threads; results in item order. */
async function solveAll(job: Job): Promise<PartResult[]> {
  const n = Math.max(1, Math.min(availableParallelism(), job.items.length));
  const slices = Array.from({ length: n }, (_, k) => job.items.filter((_, i) => i % n === k));
  const done = await Promise.all(
    slices.map(
      (items) =>
        new Promise<PartResult[]>((resolve, reject) => {
          const w = new Worker(new URL('./all-parts-worker.mjs', import.meta.url), {
            workerData: { ...job, items } satisfies Job,
          });
          w.once('message', resolve);
          w.once('error', reject);
        }),
    ),
  );
  const at = new Map(done.flat().map((r) => [r.item, r]));
  return job.items.map((i) => at.get(i)!);
}

/** Likely usage per node resource: summed share of each plan's NNE over the mean share. */
export function usageSeed(model: Model, results: readonly PartResult[]) {
  const share = new Map<string, { sum: number; parts: number }>();
  for (const r of [...new Set(model.nodes.map((n) => n.resource))].sort())
    share.set(r, { sum: 0, parts: 0 });
  for (const p of results) {
    const total = Object.values(p.nne).reduce((a, b) => a + b, 0);
    if (!(total > 0)) continue;
    for (const [r, v] of Object.entries(p.nne)) {
      const s = share.get(r);
      if (!s || !(v > 0)) continue;
      s.sum += v / total;
      s.parts++;
    }
  }
  const mean = [...share.values()].reduce((a, s) => a + s.sum, 0) / share.size;
  return [...share].map(([resource, s]) => ({
    resource,
    usage: Math.max(0.05, Math.round((s.sum / mean) * 100) / 100),
    share: s.sum / results.length,
    parts: s.parts,
  }));
}

async function main() {
  const sweep = process.argv.includes('--sweep');
  const model = (await runPipeline()).result.model!;
  const items = partTargets(model);
  const objectives: ObjectiveId[] | undefined = sweep ? ['resources'] : undefined;
  const started = Date.now();
  const results = await solveAll({ model, items, ...(objectives ? { objectives } : {}) });
  const failed = results.filter((r) => r.status !== 'ok' || r.errors.length);
  const name = new Map(model.items.map((i) => [i.id, i.name]));
  console.log(
    `${results.length - failed.length}/${results.length} parts solve ` +
      `(${((Date.now() - started) / 1000).toFixed(0)} s; known gaps left out: ${Object.keys(KNOWN_GAPS).join(', ')}).`,
  );
  for (const f of failed)
    console.log(
      `  FAIL ${name.get(f.item) ?? f.item} (${f.item}): ${f.status} ${f.errors.join(' | ')}`,
    );
  if (sweep) {
    const usage: Record<string, { usage: number; reason: string }> = {};
    for (const u of usageSeed(model, results)) {
      const n = name.get(u.resource) ?? u.resource;
      usage[n] = {
        usage: u.usage,
        reason:
          `Sweep 2026-10-13: ${(u.share * 100).toFixed(2)}% of the NNE of all ${results.length} ` +
          `part plans (O1, 1/min), used by ${u.parts}.`,
      };
    }
    console.log(JSON.stringify({ usage }, null, 2));
  }
  if (!sweep && failed.length) process.exit(1);
}

if (!isMainThread) {
  const job = workerData as Job;
  const backend = createHighsBackend();
  const out: PartResult[] = [];
  for (const item of job.items) out.push(await solvePart(job.model, item, job.objectives, backend));
  parentPort!.postMessage(out);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
