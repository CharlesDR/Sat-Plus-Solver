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

/**
 * Whether a better drill has replaced this miner route at `maxTier` (DF-1,
 * A98): at its `supersededAt` tier and above, and with no max tier.
 */
export function isSuperseded(
  recipe: Pick<Recipe, 'supersededAt'>,
  maxTier: string | undefined,
): boolean {
  if (recipe.supersededAt === undefined) return false;
  return maxTier === undefined || compareTiers(maxTier, recipe.supersededAt) >= 0;
}

/** A toggle or tweak on a miner route's best-drill id applies at every drill (DF-1). */
const names = (recipe: Pick<Recipe, 'id' | 'family'>, ids: readonly string[] | undefined) =>
  !!ids &&
  (ids.includes(recipe.id) || (recipe.family !== undefined && ids.includes(recipe.family)));

/** Why a recipe is left out, or `undefined` when it is eligible. Exclusion wins over inclusion. */
export function recipeExclusion(
  recipe: Pick<Recipe, 'id' | 'alternate' | 'tier' | 'supersededAt' | 'family'>,
  filter: RecipeFilter | undefined,
): 'excluded' | 'alternate' | 'tier' | 'superseded' | undefined {
  if (names(recipe, filter?.exclude)) return 'excluded';
  if (aboveTier(recipe.tier, filter?.maxTier)) return 'tier';
  if (isSuperseded(recipe, filter?.maxTier)) return 'superseded';
  if (
    recipe.alternate &&
    !(filter?.alternates ?? DEFAULT_ALTERNATES) &&
    !names(recipe, filter?.include)
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
  const has = (set: Set<string>, r: Recipe) =>
    set.has(r.id) || (r.family !== undefined && set.has(r.family));
  for (const r of recipes) {
    const out =
      has(exclude, r) ||
      aboveTier(r.tier, filter?.maxTier) ||
      isSuperseded(r, filter?.maxTier) ||
      (r.alternate && !alternates && !has(include, r));
    (out ? disabled : enabled).push(r);
  }
  return { enabled, disabled };
}
