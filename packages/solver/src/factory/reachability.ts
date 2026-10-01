import type { Recipe } from '@sps/data';

/**
 * Items producible from the given sources: a recipe can run once all of its
 * inputs are producible, and then its outputs are. Recipes with no inputs
 * (extraction) can always run. Node budgets are ignored here: running out of
 * nodes is an infeasibility (elastic re-solve), not unreachability.
 */
export function producible(recipes: readonly Recipe[], sources: Iterable<string>): Set<string> {
  const have = new Set(sources);
  let pending = [...recipes];
  for (;;) {
    const next: Recipe[] = [];
    for (const r of pending) {
      if (r.inputs.every((f) => have.has(f.item))) for (const f of r.outputs) have.add(f.item);
      else next.push(r);
    }
    if (next.length === pending.length) return have;
    pending = next;
  }
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
  const runnable = recipes.filter((r) => r.inputs.every((f) => available.has(f.item)));
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
    else if (direct(r) && r.inputs.every((f) => all.has(f.item)))
      ranked.push({ id: r.id, rank: 2 });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit)
    .map((r) => r.id);
}
