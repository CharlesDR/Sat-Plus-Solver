import type { Flow, Recipe } from '@sps/data';

/**
 * The flows of `r` that can run once `ready` holds for each of its inputs: all
 * of them, or for a heater (A17) whose boiler input is missing, only the
 * heater side (a heater can burn fuel with its boiler idle).
 */
function runnableOutputs(r: Recipe, ready: (f: Flow) => boolean): Flow[] | undefined {
  if (r.inputs.every(ready)) return r.outputs;
  if (r.heater && r.inputs.every((f) => !f.heater || ready(f)))
    return r.outputs.filter((f) => f.heater);
  return undefined;
}

/**
 * Items producible from the given sources: a recipe can run once all of its
 * inputs are producible, and then its outputs are. Recipes with no inputs
 * (extraction) can always run, and a heater's exhaust needs only its fuel
 * (A17). Node budgets are ignored here: running out of nodes is an
 * infeasibility (elastic re-solve), not unreachability.
 */
export function producible(recipes: readonly Recipe[], sources: Iterable<string>): Set<string> {
  const have = new Set(sources);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of recipes) {
      for (const f of runnableOutputs(r, (g) => have.has(g.item)) ?? []) {
        if (have.has(f.item)) continue;
        have.add(f.item);
        grew = true;
      }
    }
  }
  return have;
}

/**
 * Reverse-reachability pruning (§5): keeps the recipes that can run from the
 * sources and produce something the demand transitively needs. A recipe whose
 * outputs are all unneeded can only add cost, since surplus is free disposal.
 */
export function prune(
  recipes: readonly Recipe[],
  available: ReadonlySet<string>,
  demanded: Iterable<string>,
): Recipe[] {
  const runnable = recipes.filter((r) => runnableOutputs(r, (f) => available.has(f.item)));
  const needed = new Set(demanded);
  const kept = new Set<Recipe>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of runnable) {
      if (kept.has(r) || !r.outputs.some((f) => needed.has(f.item))) continue;
      kept.add(r);
      grew = true;
      for (const f of r.inputs) needed.add(f.item);
    }
  }
  return runnable.filter((r) => kept.has(r));
}

/**
 * Disabled recipes that would make `item` producible, closest first: recipes
 * that fix it on their own when enabled (direct producers of the item before
 * upstream ones), then direct producers that need more than one recipe
 * enabled. Ties break by id, so the order is stable.
 */
export function closestFixes(
  item: string,
  enabled: readonly Recipe[],
  disabled: readonly Recipe[],
  sources: readonly string[],
  limit = 5,
): string[] {
  const all = producible([...enabled, ...disabled], sources);
  if (!all.has(item)) return [];
  const direct = (r: Recipe) => r.outputs.some((f) => f.item === item);
  const ranked: { id: string; rank: number }[] = [];
  for (const r of disabled) {
    if (producible([...enabled, r], sources).has(item))
      ranked.push({ id: r.id, rank: direct(r) ? 0 : 1 });
    else if (direct(r) && runnableOutputs(r, (f) => all.has(f.item)))
      ranked.push({ id: r.id, rank: 2 });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit)
    .map((r) => r.id);
}
