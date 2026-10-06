import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { recipeRows, type RecipeRow, type RecipeView } from '../recipeView';
import type { CatalogRecipe } from '../solver/protocol';
import type { Scope, WorldStore } from '../store';

/** Rows rendered at once; a search narrows the rest. */
export const RECIPE_PAGE = 100;

const VIEWS: [RecipeView, string][] = [
  ['all', 'All'],
  ['standard', 'Standard'],
  ['alternates', 'Alternates'],
  ['on', 'On'],
  ['off', 'Off'],
  ['changed', 'Changed here'],
];

const REASONS: Record<NonNullable<RecipeRow['reason']>, string> = {
  excluded: 'off',
  alternate: 'alternates off',
  tier: 'above max tier',
};

interface Props {
  store: WorldStore;
  scope: Scope;
  recipes: CatalogRecipe[];
}

/**
 * Per-recipe toggles with search, a view filter and bulk actions. Standard
 * recipes start on and alternates off; a toggle here wins over the default
 * (and, for a factory, over the world's toggle).
 */
export function RecipeToggles({ store, scope, recipes }: Props) {
  const world = useStore(store, (s) => s.world);
  const setRecipes = useStore(store, (s) => s.setRecipes);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<RecipeView>('all');
  const rows = useMemo(
    () => recipeRows(world, scope, recipes, search, view),
    [world, scope, recipes, search, view],
  );
  const shown = rows.slice(0, RECIPE_PAGE);
  const ids = rows.map((r) => r.recipe.id);
  const where = scope.kind === 'world' ? 'all factories' : 'this factory';

  return (
    <fieldset className="recipes" aria-label="Recipes">
      <div className="row">
        <label>
          Search recipes
          <input
            type="search"
            value={search}
            placeholder="Name, machine or product…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Show
          <select value={view} onChange={(e) => setView(e.target.value as RecipeView)}>
            {VIEWS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row bulk">
        <span data-testid="recipe-count">
          {rows.length} recipe{rows.length === 1 ? '' : 's'}
        </span>
        <button type="button" disabled={!ids.length} onClick={() => setRecipes(scope, ids, true)}>
          Turn all on
        </button>
        <button type="button" disabled={!ids.length} onClick={() => setRecipes(scope, ids, false)}>
          Turn all off
        </button>
        <button
          type="button"
          disabled={!rows.some((r) => r.toggle !== undefined)}
          onClick={() => setRecipes(scope, ids, undefined)}
        >
          Reset to defaults
        </button>
        <span className="hint">
          Applies to the {rows.length} listed, for {where}.
        </span>
      </div>
      <ul className="recipe-list" aria-label="Recipe toggles">
        {shown.map((r) => (
          <li key={r.recipe.id} className={r.on ? 'on' : 'off'}>
            <label className="check">
              <input
                type="checkbox"
                checked={r.on}
                disabled={r.reason === 'tier' || r.tweaked}
                onChange={(e) => setRecipes(scope, [r.recipe.id], e.target.checked)}
              />
              <span className="name">{r.recipe.name}</span>
            </label>
            <span className="meta">
              {r.recipe.machine} · tier {r.recipe.tier}
              {r.recipe.alternate && <span className="badge">alternate</span>}
              {r.reason && <span className="badge muted">{REASONS[r.reason]}</span>}
              {r.tweaked && <span className="badge tweak">set by a plan tweak</span>}
              {r.toggle !== undefined && (
                <button
                  type="button"
                  className="link"
                  aria-label={`Reset ${r.recipe.name}`}
                  onClick={() => setRecipes(scope, [r.recipe.id], undefined)}
                >
                  reset
                </button>
              )}
              {r.toggle === undefined && r.inherited !== undefined && (
                <span className="badge muted">world: {r.inherited ? 'on' : 'off'}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && (
        <p className="hint">
          Showing {shown.length} of {rows.length}. Search to narrow the list.
        </p>
      )}
    </fieldset>
  );
}
