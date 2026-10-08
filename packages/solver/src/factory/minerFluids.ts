import type { Recipe } from '@sps/data';

/**
 * Which optional fluid modules Modular Miner routes may use (A69):
 * `any` models them all, `water` only Water, `none` none. An ore with no
 * plain route keeps the cheapest fluid it allows: Water where the data lists
 * it, otherwise every fluid it allows.
 */
export type MinerFluids = 'any' | 'water' | 'none';

/** Where the fluid that miner routes consume comes from (A69). */
export type MinerFluidSupply = 'local' | 'outside';

/** Per ore: whether it has a route with no fluid, and the fluids its routes allow (sorted). */
export interface MinerFluidOptions {
  plain: boolean;
  fluids: string[];
}

/** The miner fluid options of every ore with Modular Miner routes, from the data. */
export function minerFluidOptions(recipes: readonly Recipe[]): Map<string, MinerFluidOptions> {
  const out = new Map<string, { plain: boolean; fluids: Set<string> }>();
  for (const r of recipes) {
    if (!r.route) continue;
    const o = out.get(r.route.resource) ?? { plain: false, fluids: new Set<string>() };
    if (r.route.fluid === null) o.plain = true;
    else o.fluids.add(r.route.fluid);
    out.set(r.route.resource, o);
  }
  return new Map(
    [...out].map(([ore, o]) => [ore, { plain: o.plain, fluids: [...o.fluids].sort() }]),
  );
}

/** Leaves out the miner routes `mode` doesn't allow; other recipes pass through. */
export function filterMinerRoutes(recipes: readonly Recipe[], mode: MinerFluids): Recipe[] {
  if (mode === 'any') return [...recipes];
  const options = minerFluidOptions(recipes);
  return recipes.filter((r) => {
    const fluid = r.route?.fluid;
    if (!r.route || fluid === null || fluid === undefined) return true;
    const o = options.get(r.route.resource)!;
    if (fluid === 'water') return mode === 'water' || !o.plain;
    // Another fluid: only where the ore has neither a plain nor a Water route.
    return !o.plain && !o.fluids.includes('water');
  });
}

/** The balance-row item a miner route draws its fluid from when it is supplied from outside. */
export const minerSupplyItem = (fluid: string) => `miner-supply:${fluid}`;
