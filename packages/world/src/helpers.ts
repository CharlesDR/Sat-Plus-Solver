/**
 * World editing helpers (docs/ARCHITECTURE.md §4.4–4.5): "allocate remaining"
 * node budgets and "size power plant". Pure: each returns a new `World`.
 */
import { MW_ITEM_ID, type Model } from '@sps/data';
import type { World } from './document';
import { createSolveCache, type SolveCache } from './hash';
import { resolveWorld, type ResolveOptions } from './resolve';
import type { SolveFactory, WorldResult } from './types';

/**
 * Sets `factoryId`'s node budget to the map pool minus every other factory's
 * current usage in `result` (never below 0), for every node class (§4.4).
 */
export function allocateRemaining(
  world: World,
  model: Pick<Model, 'nodes'>,
  result: WorldResult,
  factoryId: string,
): World {
  if (!world.factories.some((f) => f.id === factoryId))
    throw new Error(`Unknown factory "${factoryId}".`);
  const others = new Map<string, number>();
  for (const f of result.factories)
    if (f.id !== factoryId)
      for (const n of f.nodes) others.set(n.node, (others.get(n.node) ?? 0) + n.used);
  const budget: Record<string, number> = {};
  for (const n of [...model.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)))
    budget[n.id] = Math.max(0, (world.nodePool[n.id] ?? n.count) - (others.get(n.id) ?? 0));
  return {
    ...world,
    factories: world.factories.map((f) => (f.id === factoryId ? { ...f, nodeBudget: budget } : f)),
  };
}

/** Most re-solves "size power plant" makes while the plant's own draw moves the balance. */
export const SIZE_POWER_ITERATIONS = 10;
/** Net power within this fraction of the draw (at least 1 MW) of zero counts as balanced. */
const POWER_TOL = 1e-9;

/**
 * "Size power plant" (§4.5): sets `factoryId`'s `MW` target so the save's net
 * power is zero on the single grid (A8). The plant's own machines draw power
 * too, so it re-solves until the balance holds, at most
 * `SIZE_POWER_ITERATIONS` times. Heater plants (A17) need no special case:
 * the boilers throttle, so generation is exact while fuel rounds up to whole
 * heaters. The target never goes below 0. Returns the new world and its result.
 */
export async function sizePowerPlant(
  world: World,
  model: Model,
  solveFactory: SolveFactory,
  factoryId: string,
  cache: SolveCache = createSolveCache(),
  options: ResolveOptions = {},
): Promise<{ world: World; result: WorldResult; iterations: number }> {
  if (!world.factories.some((f) => f.id === factoryId))
    throw new Error(`Unknown factory "${factoryId}".`);
  let w = world;
  let result = await resolveWorld(w, model, solveFactory, cache, options);
  // Net power is close to linear in the plant's target (its own draw grows
  // with it), so a secant step usually lands in one or two re-solves.
  let previous: { target: number; net: number } | undefined;
  for (let k = 0; k < SIZE_POWER_ITERATIONS; k++) {
    const net = result.power.netMW;
    const current = mwTarget(w, factoryId);
    if (Math.abs(net) <= POWER_TOL * Math.max(1, result.power.consumptionMW))
      return { world: w, result, iterations: k };
    if (result.factories.find((f) => f.id === factoryId)!.status === 'infeasible' && k > 0)
      return { world: w, result, iterations: k };
    let slope = -1;
    if (previous && current !== previous.target) {
      const s = (net - previous.net) / (current - previous.target);
      if (Number.isFinite(s) && s < 0) slope = s;
    }
    const target = Math.max(0, current - net / slope);
    if (target === current) return { world: w, result, iterations: k };
    previous = { target: current, net };
    w = setTarget(w, factoryId, target);
    result = await resolveWorld(w, model, solveFactory, cache, options);
  }
  return { world: w, result, iterations: SIZE_POWER_ITERATIONS };
}

function mwTarget(world: World, factoryId: string): number {
  return world.factories
    .find((f) => f.id === factoryId)!
    .request.targets.filter((t) => t.item === MW_ITEM_ID)
    .reduce((s, t) => s + t.rate, 0);
}

function setTarget(world: World, factoryId: string, mw: number): World {
  return {
    ...world,
    factories: world.factories.map((f) => {
      if (f.id !== factoryId) return f;
      const targets = f.request.targets.filter((t) => t.item !== MW_ITEM_ID);
      if (mw > 0) targets.push({ item: MW_ITEM_ID, rate: mw });
      return { ...f, request: { ...f.request, targets } };
    }),
  };
}
