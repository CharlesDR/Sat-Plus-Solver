/**
 * The app store. Its `world` is the `World` document, which is also the
 * save/share format (CLAUDE.md). Every edit replaces the parts it touches and
 * shares the rest, so unchanged factories keep their identity.
 */
import type { ItemRate, ObjectiveId } from '@sps/solver';
import * as edit from '@sps/world';
import {
  clampTolerance,
  createWorld,
  type Factory,
  type FactoryRequest,
  type LinkSpec,
  type UnassignedImport,
  type World,
  type WorldDefaults,
} from '@sps/world';
import { createStore } from 'zustand/vanilla';

/** The settings a factory inherits from the world defaults and may override. */
export interface Settings {
  objectives: ObjectiveId[];
  tolerance: number;
  alternates: boolean;
  wholeMachines: boolean;
  costImports: boolean;
  maxTier: string | null;
}
export type SettingKey = keyof Settings;

/** Where an edit lands: the world defaults, or one factory's overrides. */
export type Scope = { kind: 'world' } | { kind: 'factory'; id: string };

export interface WorldState {
  world: World;
  /** Set when the world was made against different game data than the loaded model. */
  dataHashMismatch?: { world: string; model: string } | undefined;
  /** The loaded model's data hash, once the solver is ready. */
  modelHash?: string;
  /** Replaces the factory's targets. */
  setTargets(factoryId: string, targets: ItemRate[]): void;
  /** Sets a setting in a scope; `undefined` on a factory removes its override (inherit). */
  setSetting<K extends SettingKey>(scope: Scope, key: K, value: Settings[K] | undefined): void;
  /** Turns recipes on or off in a scope; `undefined` removes the scope's toggle. */
  setRecipes(scope: Scope, ids: readonly string[], on: boolean | undefined): void;
  setUnassignedImports(factoryId: string, imports: UnassignedImport[]): void;
  setNodeBudget(factoryId: string, budget: Factory['nodeBudget']): void;
  /** Records the loaded model's hash; a different non-empty hash is a warning, not an error. */
  attachData(dataHash: string): void;
  /**
   * Replaces the document with a loaded one (a save slot, a file or a share
   * link) and checks its data hash against the model's (PLAN M9).
   */
  loadWorld(world: World): void;

  // World editing (M8). Bad edits throw `WorldEditError` and leave the world unchanged.
  /** Returns the new factory's id. */
  addFactory(name: string, groupId?: string): string;
  removeFactory(id: string): void;
  renameFactory(id: string, name: string): void;
  setFactoryGroup(id: string, groupId: string | undefined): void;
  /** Returns the new group's id. */
  addGroup(name: string, parentId?: string): string;
  removeGroup(id: string): void;
  renameGroup(id: string, name: string): void;
  setGroupParent(id: string, parentId: string | undefined): void;
  setGroupCollapsed(id: string, collapsed: boolean): void;
  /** Returns the new link's id. */
  addLink(spec: LinkSpec): string;
  updateLink(id: string, spec: LinkSpec): void;
  removeLink(id: string): void;
  /** Replaces the document with an edited copy ("allocate remaining", "size power plant"). */
  replaceWorld(world: World): void;
}

export type WorldStore = ReturnType<typeof createWorldStore>;

/** Normalizes a setting value: tolerance clamps to 0.01%–90%; an empty stack is not allowed. */
function clean<K extends SettingKey>(key: K, value: Settings[K]): Settings[K] {
  if (key === 'tolerance') return clampTolerance(value as number) as Settings[K];
  if (key === 'objectives') {
    const stack = [...new Set(value as ObjectiveId[])];
    if (!stack.length) throw new Error('The objective stack needs at least one objective.');
    return stack as Settings[K];
  }
  return value;
}

/** Applies toggles to a map; `undefined` deletes. Returns a new map. */
function toggled(
  map: Readonly<Record<string, boolean>>,
  ids: readonly string[],
  on: boolean | undefined,
): Record<string, boolean> {
  const out = { ...map };
  for (const id of ids) {
    if (on === undefined) delete out[id];
    else out[id] = on;
  }
  return out;
}

export function createWorldStore(initial: World = createWorld()) {
  return createStore<WorldState>()((set) => {
    /** Replaces one factory, throwing on an unknown id. */
    const editFactory = (factoryId: string, edit: (f: Factory) => Factory) =>
      set(({ world }) => {
        if (!world.factories.some((f) => f.id === factoryId))
          throw new Error(`Unknown factory "${factoryId}".`);
        return {
          world: {
            ...world,
            factories: world.factories.map((f) => (f.id === factoryId ? edit(f) : f)),
          },
        };
      });
    const editRequest = (factoryId: string, edit: (r: FactoryRequest) => FactoryRequest) =>
      editFactory(factoryId, (f) => ({ ...f, request: edit(f.request) }));
    const editDefaults = (edit: (d: WorldDefaults) => WorldDefaults) =>
      set(({ world }) => ({ world: { ...world, defaults: edit(world.defaults) } }));

    /** Applies a pure world edit. */
    const apply = (f: (w: World) => World) => set(({ world }) => ({ world: f(world) }));
    /** Applies a pure world edit that creates something, returning its id. */
    const create = (f: (w: World) => { world: World; id: string }) => {
      let id = '';
      set(({ world }) => {
        const out = f(world);
        id = out.id;
        return { world: out.world };
      });
      return id;
    };

    return {
      world: initial,
      setTargets: (factoryId, targets) =>
        editRequest(factoryId, (r) => ({ ...r, targets: targets.map((t) => ({ ...t })) })),
      setSetting: (scope, key, value) => {
        if (scope.kind === 'world') {
          if (value === undefined) throw new Error('A world default cannot be unset.');
          return editDefaults((d) => ({ ...d, [key]: clean(key, value) }));
        }
        editRequest(scope.id, (r) => {
          const next: FactoryRequest = { ...r };
          if (value === undefined) delete next[key];
          else Object.assign(next, { [key]: clean(key, value) });
          return next;
        });
      },
      setRecipes: (scope, ids, on) => {
        if (scope.kind === 'world')
          return editDefaults((d) => ({ ...d, recipes: toggled(d.recipes, ids, on) }));
        editRequest(scope.id, (r) => {
          const recipes = toggled(r.recipes ?? {}, ids, on);
          const next: FactoryRequest = { ...r, recipes };
          if (!Object.keys(recipes).length) delete next.recipes;
          return next;
        });
      },
      setUnassignedImports: (factoryId, imports) =>
        editFactory(factoryId, (f) => ({
          ...f,
          unassignedImports: imports.map((i) => ({ ...i })),
        })),
      setNodeBudget: (factoryId, budget) =>
        editFactory(factoryId, (f) => ({
          ...f,
          nodeBudget: budget === 'pool' ? 'pool' : { ...budget },
        })),
      attachData: (dataHash) =>
        set(({ world }) => ({ modelHash: dataHash, ...checkData(world, dataHash) })),
      loadWorld: (world) =>
        set(({ modelHash }) =>
          modelHash === undefined
            ? { world, dataHashMismatch: undefined }
            : checkData(world, modelHash),
        ),
      addFactory: (name, groupId) => create((w) => edit.addFactory(w, name, groupId)),
      removeFactory: (id) => apply((w) => edit.removeFactory(w, id)),
      renameFactory: (id, name) => apply((w) => edit.renameFactory(w, id, name)),
      setFactoryGroup: (id, groupId) => apply((w) => edit.setFactoryGroup(w, id, groupId)),
      addGroup: (name, parentId) => create((w) => edit.addGroup(w, name, parentId)),
      removeGroup: (id) => apply((w) => edit.removeGroup(w, id)),
      renameGroup: (id, name) => apply((w) => edit.renameGroup(w, id, name)),
      setGroupParent: (id, parentId) => apply((w) => edit.setGroupParent(w, id, parentId)),
      setGroupCollapsed: (id, collapsed) => apply((w) => edit.setGroupCollapsed(w, id, collapsed)),
      addLink: (spec) => create((w) => edit.addLink(w, spec)),
      updateLink: (id, spec) => apply((w) => edit.updateLink(w, id, spec)),
      removeLink: (id) => apply((w) => edit.removeLink(w, id)),
      replaceWorld: (world) => set({ world }),
    };
  });
}

/**
 * A world against the model's data hash: a world with no hash adopts the
 * model's; a different hash is flagged, and the world still loads.
 */
function checkData(world: World, model: string): Pick<WorldState, 'world' | 'dataHashMismatch'> {
  if (world.meta.dataHash === model) return { world, dataHashMismatch: undefined };
  if (world.meta.dataHash === '')
    return {
      world: { ...world, meta: { ...world.meta, dataHash: model } },
      dataHashMismatch: undefined,
    };
  return { world, dataHashMismatch: { world: world.meta.dataHash, model } };
}

/** The settings a factory runs with, and which of them it overrides. */
export function effectiveSettings(
  world: World,
  factoryId: string,
): { values: Settings; overridden: Record<SettingKey, boolean> } {
  const d = world.defaults;
  const r = world.factories.find((f) => f.id === factoryId)?.request ?? { targets: [] };
  const keys: SettingKey[] = [
    'objectives',
    'tolerance',
    'alternates',
    'wholeMachines',
    'costImports',
    'maxTier',
  ];
  const values = {} as Record<SettingKey, unknown>;
  const overridden = {} as Record<SettingKey, boolean>;
  for (const k of keys) {
    overridden[k] = r[k] !== undefined;
    values[k] = r[k] !== undefined ? r[k] : d[k];
  }
  return { values: values as unknown as Settings, overridden };
}
