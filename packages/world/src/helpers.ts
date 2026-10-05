/**
 * World editing helpers (docs/ARCHITECTURE.md §4.4–4.5): "allocate remaining"
 * resource limits and "size power plant". Pure: each returns a new `World`.
 */
import { MW_ITEM_ID, type Model } from '@sps/data';
import type { RawResource } from '@sps/solver';
import type { ResourceLimit, World } from './document';
import { createSolveCache, type SolveCache } from './hash';
import { resolveWorld, type ResolveOptions } from './resolve';
import type { FactoryResult, SolveFactory, WorldResult } from './types';

/**
 * Sets `factoryId`'s limit on every node-limited resource to what the map
 * pool can extract (`resources`, from `rawResources(model, world.nodePool)`)
 * minus what every other factory extracts in `result`, never below 0 (§4.4,
 * A33). Resources the factory has turned off stay off.
 */
export function allocateRemaining(
  world: World,
  resources: readonly RawResource[],
  result: { factories: readonly Pick<FactoryResult, 'id' | 'extraction'>[] },
  factoryId: string,
): World {
  const factory = world.factories.find((f) => f.id === factoryId);
  if (!factory) throw new Error(`Unknown factory "${factoryId}".`);
  const others = new Map<string, number>();
  for (const f of result.factories)
    if (f.id !== factoryId)
      for (const e of f.extraction) others.set(e.item, (others.get(e.item) ?? 0) + e.rate);
  const limits: Record<string, ResourceLimit> = { ...factory.resources };
  for (const r of resources) {
    if (!r.limited) continue;
    const max = Math.max(0, (r.mapMax ?? 0) - (others.get(r.item) ?? 0));
    limits[r.item] = { enabled: limits[r.item]?.enabled ?? true, max };
  }
  return {
    ...world,
    factories: world.factories.map((f) => (f.id === factoryId ? { ...f, resources: limits } : f)),
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
