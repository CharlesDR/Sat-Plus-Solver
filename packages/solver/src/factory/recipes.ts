/**
 * Recipe eligibility (docs/ARCHITECTURE.md §3.1, PLAN M6): which recipes a
 * factory may use, from its `RecipeFilter`. Shared by the solver and the UI,
 * so the recipe list shows exactly what the solve uses.
 */
import type { Recipe } from '@sps/data';
import type { RecipeFilter } from './types';

/** Default of `RecipeFilter.alternates`: standard recipes only (alternates are opt-in). */
export const DEFAULT_ALTERNATES = false;

/** A dataset tier `"<major>-<minor>"` as numbers; `undefined` when it isn't one. */
export function parseTier(tier: string): [number, number] | undefined {
  const m = /^(\d+)-(\d+)$/.exec(tier.trim());
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** Orders tiers major first, then minor (`1-0` > `0-6`). Unparseable tiers sort first. */
export function compareTiers(a: string, b: string): number {
  const ta = parseTier(a) ?? [-1, -1];
  const tb = parseTier(b) ?? [-1, -1];
  return ta[0] - tb[0] || ta[1] - tb[1];
}

/**
 * Whether a recipe's tier is above `maxTier`. Tier `0-0` (the dataset's value
 * for recipes with no milestone, such as MAM and starting recipes) and
 * unparseable tiers are never above any limit (A23).
 */
export function aboveTier(tier: string, maxTier: string | undefined): boolean {
  if (maxTier === undefined) return false;
  const t = parseTier(tier);
  if (!t || (t[0] === 0 && t[1] === 0)) return false;
  return compareTiers(tier, maxTier) > 0;
}

/** Why a recipe is left out, or `undefined` when it is eligible. Exclusion wins over inclusion. */
export function recipeExclusion(
  recipe: Pick<Recipe, 'id' | 'alternate' | 'tier'>,
  filter: RecipeFilter | undefined,
): 'excluded' | 'alternate' | 'tier' | undefined {
  if (filter?.exclude?.includes(recipe.id)) return 'excluded';
  if (aboveTier(recipe.tier, filter?.maxTier)) return 'tier';
  if (
    recipe.alternate &&
    !(filter?.alternates ?? DEFAULT_ALTERNATES) &&
    !filter?.include?.includes(recipe.id)
  )
    return 'alternate';
  return undefined;
}

/** Splits the model's recipes into those the filter allows and those it leaves out. */
export function filterRecipes(
  recipes: readonly Recipe[],
  filter: RecipeFilter | undefined,
): { enabled: Recipe[]; disabled: Recipe[] } {
  const exclude = new Set(filter?.exclude ?? []);
  const include = new Set(filter?.include ?? []);
  const alternates = filter?.alternates ?? DEFAULT_ALTERNATES;
  const enabled: Recipe[] = [];
  const disabled: Recipe[] = [];
  for (const r of recipes) {
    const out =
      exclude.has(r.id) ||
      aboveTier(r.tier, filter?.maxTier) ||
      (r.alternate && !alternates && !include.has(r.id));
    (out ? disabled : enabled).push(r);
  }
  return { enabled, disabled };
}
