/**
 * The recipe toggle list as data: which recipes match the search and view,
 * and for each, whether the factory (or the world defaults) may use it and why
 * not. Uses the solver's own `recipeExclusion`, so the list shows exactly what
 * the solve uses.
 */
import { recipeExclusion } from '@sps/solver';
import { recipeFilter, type Factory, type World } from '@sps/world';
import type { CatalogRecipe } from './solver/protocol';
import type { Scope } from './store';

export type RecipeView = 'all' | 'standard' | 'alternates' | 'on' | 'off' | 'changed';

export interface RecipeRow {
  recipe: CatalogRecipe;
  /** Eligible in this scope. */
  on: boolean;
  /** Why it is off, when it is. */
  reason?: 'excluded' | 'alternate' | 'tier';
  /** This scope's own toggle, if any. */
  toggle?: boolean;
  /** In a factory scope, the world's toggle it inherits, if any. */
  inherited?: boolean;
  /** A plan tweak (A35) turned it on or off, over the toggles. */
  tweaked?: boolean;
}

/** The world defaults on their own, as a factory with no overrides. */
const bare = (): Factory => ({
  id: '',
  name: '',
  request: { targets: [] },
  unassignedImports: [],
  resources: {},
  priority: 0,
  notes: '',
  tweaks: [],
});

export function recipeRows(
  world: World,
  scope: Scope,
  recipes: readonly CatalogRecipe[],
  search = '',
  view: RecipeView = 'all',
): RecipeRow[] {
  const factory =
    scope.kind === 'factory' ? world.factories.find((f) => f.id === scope.id) : undefined;
  if (scope.kind === 'factory' && !factory) throw new Error(`Unknown factory "${scope.id}".`);
  const filter = recipeFilter(world, factory ?? bare());
  const untweaked = recipeFilter(world, factory ?? bare(), { tweaks: false });
  const own = factory ? (factory.request.recipes ?? {}) : world.defaults.recipes;
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const rows: RecipeRow[] = [];
  for (const recipe of recipes) {
    if (view === 'standard' && recipe.alternate) continue;
    if (view === 'alternates' && !recipe.alternate) continue;
    if (words.length) {
      const text = [recipe.name, recipe.id, recipe.machine, ...recipe.products]
        .join(' ')
        .toLowerCase();
      if (!words.every((w) => text.includes(w))) continue;
    }
    const reason = recipeExclusion(recipe, filter);
    const row: RecipeRow = { recipe, on: reason === undefined };
    if (reason) row.reason = reason;
    if ((reason === undefined) !== (recipeExclusion(recipe, untweaked) === undefined))
      row.tweaked = true;
    const toggle = own[recipe.id];
    if (toggle !== undefined) row.toggle = toggle;
    const inherited = factory ? world.defaults.recipes[recipe.id] : undefined;
    if (inherited !== undefined) row.inherited = inherited;
    if (view === 'on' && !row.on) continue;
    if (view === 'off' && row.on) continue;
    if (view === 'changed' && row.toggle === undefined) continue;
    rows.push(row);
  }
  return rows;
}
