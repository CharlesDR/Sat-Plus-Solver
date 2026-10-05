/**
 * Raw resources and what each extraction recipe draws (A33): the unit of a
 * factory's resource limits (`SolveRequest.resourceLimits`).
 */
import type { Model, Recipe } from '@sps/data';

/** A raw resource a factory can enable, disable or limit. */
export interface RawResource {
  /** Item id. */
  item: string;
  /** Node-limited (ores, oil, gases on nodes or sites); `false` for Water, Air and the like. */
  limited: boolean;
  /**
   * Node-limited only: the most the whole map pool can extract per minute,
   * every node on its best route. `pool` overrides the map count per node id.
   */
  mapMax?: number;
}

/**
 * What one machine of `recipe` extracts per minute, or `undefined` for a
 * recipe that extracts nothing. Uses the model's `extracts`; a model without
 * it (older or hand-written ones) falls back to the recipe's output of the
 * node's resource, or its one output.
 */
export function extractionOf(
  recipe: Recipe,
  nodeResource: (node: string) => string | undefined,
): { item: string; rate: number } | undefined {
  if (recipe.kind !== 'extraction') return undefined;
  if (recipe.extracts) return recipe.extracts;
  const item = recipe.node ? nodeResource(recipe.node) : recipe.outputs[0]?.item;
  const out = item === undefined ? undefined : recipe.outputs.find((f) => f.item === item);
  return out && item !== undefined ? { item, rate: out.rate } : undefined;
}

/** The most one node of each class extracts per minute, on its best route. */
export function bestNodeRates(model: Pick<Model, 'recipes' | 'nodes'>): Map<string, number> {
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const best = new Map<string, number>();
  for (const r of model.recipes) {
    const e = r.node ? extractionOf(r, (id) => nodes.get(id)?.resource) : undefined;
    if (e) best.set(r.node!, Math.max(best.get(r.node!) ?? 0, e.rate));
  }
  return best;
}

/** Every raw resource of the model, sorted by item id. */
export function rawResources(
  model: Pick<Model, 'recipes' | 'nodes'>,
  pool: Readonly<Record<string, number>> = {},
): RawResource[] {
  const best = bestNodeRates(model);
  const mapMax = new Map<string, number>();
  for (const n of model.nodes) {
    const add = (pool[n.id] ?? n.count) * (best.get(n.id) ?? 0);
    mapMax.set(n.resource, (mapMax.get(n.resource) ?? 0) + add);
  }
  const unlimited = new Set<string>();
  for (const r of model.recipes) {
    const e = r.node ? undefined : extractionOf(r, () => undefined);
    if (e && !mapMax.has(e.item)) unlimited.add(e.item);
  }
  const out: RawResource[] = [...mapMax].map(([item, max]) => ({
    item,
    limited: true,
    mapMax: max,
  }));
  for (const item of unlimited) out.push({ item, limited: false });
  return out.sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
}
