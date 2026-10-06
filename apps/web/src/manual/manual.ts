/**
 * Manual mode (A36) as data: the plan to freeze from a solved flowchart, and
 * the recipe palette's search. Pure, so it is tested without React.
 */
import type { FactoryGraph } from '@sps/graph';
import type { ManualEntry } from '@sps/world';
import type { CatalogRecipe } from '../solver/protocol';

/**
 * The solved plan as manual entries: one per recipe group, at its running
 * throughput (a heater's boiler load × heaters, A17), sorted by recipe.
 */
export function planToFreeze(graph: FactoryGraph | undefined): ManualEntry[] {
  return (graph?.nodes ?? [])
    .filter((n) => n.recipe !== undefined && (n.kind === 'recipe' || n.kind === 'resource'))
    .map((n) => ({ recipe: n.recipe!, machines: (n.machines ?? 0) * (n.boilerLoad ?? 1) }))
    .filter((e) => e.machines > 0)
    .sort((a, b) => (a.recipe < b.recipe ? -1 : 1));
}

/** Most palette matches shown at once. */
export const PALETTE_LIMIT = 12;

/**
 * Recipes matching every search word in their name, machine or products:
 * products named exactly first, then by name; at most `PALETTE_LIMIT`.
 */
export function paletteMatches(recipes: readonly CatalogRecipe[], search: string): CatalogRecipe[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const query = words.join(' ');
  const hits = recipes.filter((r) => {
    const text = [r.name, r.machine, ...r.products].join(' ').toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const exact = (r: CatalogRecipe) => (r.products.some((p) => p.toLowerCase() === query) ? 0 : 1);
  // `recipes` is sorted by name, then id, and the sort is stable.
  return hits.sort((a, b) => exact(a) - exact(b)).slice(0, PALETTE_LIMIT);
}
