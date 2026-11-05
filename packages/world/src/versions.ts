/**
 * Switching a world's SF+ mod version (A111). Every factory re-solves on the
 * new version's data; this edit only keeps the document consistent with it.
 * References to recipes the new version lacks are dropped and reported; a
 * manual factory keeps its machine counts, with a note naming the recipes of
 * its plan that differ between the two versions. Build marks stay as marked:
 * their own checks report the change (A44). Pure.
 */
import type { Model, Recipe } from '@sps/data';
import type { Factory, ManualEntry, ManualPlan, Tweak, World } from './document';
import { WorldEditError } from './editing';

/** What named a recipe the new version lacks. */
export type DroppedKind = 'toggle' | 'tweak' | 'manual' | 'area';

export interface DroppedRecipe {
  /** Recipe id. */
  recipe: string;
  /** Its name in the old version, or the id when that version is not at hand. */
  name: string;
  /** Missing = the world's defaults. */
  factoryId?: string;
  kind: DroppedKind;
}

export interface VersionSwitch {
  world: World;
  /** Sorted by factory (world defaults first), then kind, then recipe. */
  dropped: DroppedRecipe[];
  /** Manual factories whose plan uses recipes that differ, in world order. */
  changed: { factoryId: string; recipes: string[] }[];
}

/** What a manual plan's flows depend on (A36): machine, rates, power and clock. */
function signature(r: Recipe): string {
  return JSON.stringify([r.machine, r.inputs, r.outputs, r.powerMW, r.clock, r.heater ?? false]);
}

/**
 * `world` on mod version `version`, whose model is `to`. `from` is the model
 * of the world's current version; without it (a version this build no longer
 * has), dropped recipes are named by id and manual plans get no note.
 */
export function switchModVersion(
  world: World,
  version: string,
  to: Model,
  from?: Model,
): VersionSwitch {
  if (version === world.meta.modVersion) return { world, dropped: [], changed: [] };
  const has = new Set(to.recipes.map((r) => r.id));
  const oldName = new Map(from?.recipes.map((r) => [r.id, r.name]));
  const oldSig = new Map(from?.recipes.map((r) => [r.id, signature(r)]));
  const newSig = new Map(to.recipes.map((r) => [r.id, signature(r)]));
  const dropped: DroppedRecipe[] = [];
  const drop = (recipe: string, kind: DroppedKind, factoryId?: string) =>
    dropped.push({
      recipe,
      name: oldName.get(recipe) ?? recipe,
      kind,
      ...(factoryId !== undefined ? { factoryId } : {}),
    });

  const toggles = (t: Record<string, boolean>, factoryId?: string) => {
    const out: Record<string, boolean> = {};
    for (const [id, on] of Object.entries(t))
      if (has.has(id)) out[id] = on;
      else drop(id, 'toggle', factoryId);
    return out;
  };

  const changed: VersionSwitch['changed'] = [];
  const factories = world.factories.map((f): Factory => {
    const next: Factory = { ...f };
    if (f.request.recipes)
      next.request = { ...f.request, recipes: toggles(f.request.recipes, f.id) };
    next.tweaks = f.tweaks.filter((t) => {
      const gone = tweakRecipes(t).filter((id) => !has.has(id));
      for (const id of gone) drop(id, 'tweak', f.id);
      return gone.length === 0;
    });
    if (f.manual) {
      const keep = (entries: ManualEntry[]) =>
        entries.filter((e) => {
          if (has.has(e.recipe)) return true;
          drop(e.recipe, 'manual', f.id);
          return false;
        });
      const manual: ManualPlan = {
        ...f.manual,
        frozen: keep(f.manual.frozen),
        edits: keep(f.manual.edits),
      };
      delete manual.versionNote;
      const recipes = [...new Set([...manual.frozen, ...manual.edits].map((e) => e.recipe))]
        .filter((id) => oldSig.has(id) && oldSig.get(id) !== newSig.get(id))
        .sort();
      if (manual.enabled && recipes.length) {
        manual.versionNote = { version, recipes };
        changed.push({ factoryId: f.id, recipes });
      }
      next.manual = manual;
    }
    if (f.areas?.moves) {
      const moves: Record<string, string> = {};
      for (const [node, area] of Object.entries(f.areas.moves)) {
        const id = node.startsWith('recipe:') ? node.slice('recipe:'.length) : undefined;
        if (id === undefined || has.has(id)) moves[node] = area;
        else drop(id, 'area', f.id);
      }
      next.areas = { ...f.areas, moves };
    }
    return next;
  });

  const defaults = { ...world.defaults, recipes: toggles(world.defaults.recipes) };
  const order = new Map(world.factories.map((f, i) => [f.id, i]));
  const kinds: DroppedKind[] = ['toggle', 'tweak', 'manual', 'area'];
  dropped.sort(
    (a, b) =>
      (a.factoryId === undefined ? -1 : order.get(a.factoryId)!) -
        (b.factoryId === undefined ? -1 : order.get(b.factoryId)!) ||
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
      (a.recipe < b.recipe ? -1 : a.recipe > b.recipe ? 1 : 0),
  );
  return {
    world: {
      ...world,
      meta: { ...world.meta, modVersion: version, dataHash: to.meta.dataHash },
      factories,
      defaults,
    },
    dropped,
    changed,
  };
}

const tweakRecipes = (t: Tweak): string[] =>
  t.kind === 'ban' ? [t.recipe] : t.kind === 'swap' ? [t.from, t.to] : [];

/** The factory's manual plan without its version note (A111). */
export function dismissVersionNote(world: World, factoryId: string): World {
  const f = world.factories.find((x) => x.id === factoryId);
  if (!f) throw new WorldEditError(`Unknown factory "${factoryId}".`);
  if (!f.manual?.versionNote) return world;
  const manual = { ...f.manual };
  delete manual.versionNote;
  return {
    ...world,
    factories: world.factories.map((x) => (x.id === factoryId ? { ...f, manual } : x)),
  };
}
