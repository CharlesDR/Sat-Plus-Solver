/**
 * Layout score harness (A43): lays out a fixed set of plans on the full SF+
 * model, as the app does, and scores each layout. `fixtures/layout/scores.json`
 * holds the scores the current layout must not fall below; the test in
 * `layout-score.test.ts` checks them.
 *
 *   pnpm layout-score            prints the scores next to the baseline
 *   pnpm layout-score --update   writes the current scores as the baseline
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Model } from '@sps/data';
import {
  factoryGraph,
  layoutFactoryGraph,
  layoutScore,
  type GraphLabels,
  type LayoutScore,
} from '@sps/graph';
import { createHighsBackend, solve, type SolveRequest } from '@sps/solver';
import { createWorld, factorySolveRequest } from '@sps/world';
import ELK from 'elkjs/lib/elk.bundled.js';
import { ROOT, runPipeline } from './build-data';

/**
 * The plans every layout change is measured on: two everyday plans with the
 * app's default settings, and the 150-node benchmark from the M7 test.
 */
const appDefaults = (item: string, rate: number) => (model: Model) => {
  const world = createWorld();
  world.factories[0]!.request.targets = [{ item, rate }];
  return factorySolveRequest(world, model, world.factories[0]!.id);
};
export const SCORE_PLANS: Record<string, (model: Model) => SolveRequest> = {
  'plastic-20': appDefaults('plastic', 20),
  'reinforced-iron-plate-5': appDefaults('reinforced-iron-plate', 5),
  'ballistic-warp-drive-1': () => ({
    targets: [{ item: 'ballistic-warp-drive', rate: 1 }],
    recipes: { alternates: true },
    minBranch: 0,
  }),
};

/** The app's flowchart icon size (apps/web `ICON_SIZE`), so nodes are sized as drawn. */
const ICON_SIZE = 32;

export const BASELINE = join(ROOT, 'fixtures', 'layout', 'scores.json');

export interface Baseline {
  /** No layout may bring a gap between two boxes closer than this, px. */
  minGapFloor: number;
  plans: Record<string, LayoutScore & { nodes: number }>;
}

export function loadBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
}

export async function scorePlans(
  model: Model,
): Promise<Record<string, LayoutScore & { nodes: number }>> {
  const item = new Map(model.items.map((i) => [i.id, i.name]));
  const machine = new Map(model.machines.map((m) => [m.id, m.name]));
  const labels: GraphLabels = { item: (id) => item.get(id), machine: (id) => machine.get(id) };
  const backend = createHighsBackend();
  const out: Record<string, LayoutScore & { nodes: number }> = {};
  for (const [name, request] of Object.entries(SCORE_PLANS)) {
    const result = await solve(model, request(model), backend);
    if (result.status !== 'ok') throw new Error(`${name} did not solve: ${result.status}`);
    const graph = factoryGraph(result, labels);
    const layout = await layoutFactoryGraph(graph, new ELK(), { iconSize: ICON_SIZE });
    out[name] = { nodes: graph.nodes.length, ...layoutScore(layout) };
  }
  return out;
}

async function main() {
  const { result } = await runPipeline();
  const scores = await scorePlans(result.model!);
  const base = (() => {
    try {
      return loadBaseline();
    } catch {
      return undefined;
    }
  })();
  for (const [name, s] of Object.entries(scores)) {
    const b = base?.plans[name];
    console.log(name);
    for (const [k, v] of Object.entries(s))
      console.log(
        `  ${k.padEnd(11)} ${String(v).padStart(12)}${b ? `   (baseline ${b[k as keyof typeof b]})` : ''}`,
      );
  }
  if (process.argv.includes('--update')) {
    const next: Baseline = { minGapFloor: base?.minGapFloor ?? 0, plans: scores };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Wrote ${BASELINE}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
