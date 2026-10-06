/**
 * The `World` document (docs/ARCHITECTURE.md §4.1): the root of all app state
 * and the save/share format. Plain JSON data, so no `Infinity` or `undefined`
 * values that JSON can't carry. Any shape change bumps `WORLD_VERSION` and adds
 * a migration plus a migration test (CLAUDE.md).
 *
 * M3 used a single implicit factory; M5 resolves links and groups
 * (`resolveWorld`). v2 (M5) added the whole-machines and cost-imports toggles;
 * v3 (M6) replaced the recipe exclusion lists with per-recipe toggles and
 * added the max-tier filter; v4 replaced the factory's node budget with
 * per-resource limits (A33); v5 moved worlds on the old default objective
 * stack (O1) to the new one (O2); v6 added plan tweaks (A35). `migrateWorld`
 * upgrades older documents.
 */
import type { Model } from '@sps/data';
import type { ItemRate, ObjectiveId, RecipeFilter, SolveRequest } from '@sps/solver';

export const WORLD_VERSION = 6;

/** Lexicographic tolerance bounds (CLAUDE.md): 0.01%–90%, default 0.01%. */
export const TOLERANCE_MIN = 0.0001;
export const TOLERANCE_MAX = 0.9;
export const TOLERANCE_DEFAULT = 0.0001;

/** Id of the implicit factory in a fresh world. */
export const DEFAULT_FACTORY_ID = 'factory-main';

export interface WorldMeta {
  v: typeof WORLD_VERSION;
  /** `model.meta.dataHash` the world was last edited against; '' until known. */
  dataHash: string;
}

/** Settings every factory inherits unless it overrides them. */
export interface WorldDefaults {
  /** Objective stack, highest priority first. */
  objectives: ObjectiveId[];
  /** Fraction, clamped to [TOLERANCE_MIN, TOLERANCE_MAX]. */
  tolerance: number;
  alternates: boolean;
  /** Whole machines (§3.4): integer machine counts, a MILP. */
  wholeMachines: boolean;
  /** Cost imported inputs (§3.3): linked imports at the upstream plan's marginal cost. */
  costImports: boolean;
  /**
   * Per-recipe toggles by recipe id: `false` disables a recipe, `true` enables
   * it (an alternate while `alternates` is off). A recipe not listed follows
   * the default: standard recipes on, alternates per `alternates`.
   */
  recipes: Record<string, boolean>;
  /** Leave out recipes above this dataset tier (`"<major>-<minor>"`); `null` = no limit. */
  maxTier: string | null;
}

/** Per-factory overrides of `WorldDefaults`; a missing field inherits. */
export interface FactoryRequest {
  targets: ItemRate[];
  objectives?: ObjectiveId[];
  tolerance?: number;
  alternates?: boolean;
  wholeMachines?: boolean;
  costImports?: boolean;
  /** Per-recipe toggles that win over the world's; a recipe not listed inherits. */
  recipes?: Record<string, boolean>;
  /** `null` = no limit, overriding the world's. */
  maxTier?: string | null;
}

export interface UnassignedImport {
  item: string;
  /** Per minute; missing means unlimited. */
  cap?: number;
}

/** A factory's setting for one raw resource (A33). */
export interface ResourceLimit {
  /** `false` turns the resource off: the factory extracts none of it. */
  enabled: boolean;
  /**
   * Most it may extract, per minute (m³/min for fluids). Missing = no limit
   * beyond the map's node pool. Kept while the resource is off.
   */
  max?: number;
}

export interface Factory {
  id: string;
  name: string;
  groupId?: string;
  request: FactoryRequest;
  unassignedImports: UnassignedImport[];
  /**
   * Per raw resource item id (A33). A resource not listed is on, with no
   * limit beyond the map's node pool.
   */
  resources: Record<string, ResourceLimit>;
  priority: number;
  notes: string;
  /**
   * Plan tweaks (A35): manual changes made from the flowchart, oldest first,
   * applied over the request when the factory is solved. The list is also the
   * undo history: undo drops the last, "revert all" empties it.
   */
  tweaks: Tweak[];
}

/**
 * One plan tweak (A35). `ban` turns a recipe off; `swap` turns `from` off and
 * `to` on; `import` makes an item an uncapped unassigned import, so the
 * factory buys it instead of making it. Later tweaks win over earlier ones
 * and over the request's own toggles and imports.
 */
export type Tweak =
  | { kind: 'ban'; recipe: string }
  | { kind: 'swap'; from: string; to: string }
  | { kind: 'import'; item: string };

export interface Group {
  id: string;
  name: string;
  parentId?: string;
  collapsed: boolean;
}

export type Transport = 'belt' | 'pipe' | 'train' | 'truck' | 'drone' | 'unspecified';

export interface Link {
  id: string;
  from: string;
  to: string;
  item: string;
  mode: { kind: 'fixed'; rate: number } | { kind: 'pull' };
  transport?: { kind: Transport; tier?: number };
}

export interface World {
  meta: WorldMeta;
  factories: Factory[];
  groups: Group[];
  links: Link[];
  defaults: WorldDefaults;
  /** Edits to the map-wide node counts from nodes.csv, by node id. Empty = the map counts. */
  nodePool: Record<string, number>;
}

export function defaultWorldDefaults(): WorldDefaults {
  return {
    objectives: ['scarcity'],
    tolerance: TOLERANCE_DEFAULT,
    alternates: false,
    wholeMachines: false,
    costImports: false,
    recipes: {},
    maxTier: null,
  };
}

export function createFactory(id: string, name: string): Factory {
  return {
    id,
    name,
    request: { targets: [] },
    unassignedImports: [],
    resources: {},
    priority: 0,
    notes: '',
    tweaks: [],
  };
}

/** A fresh world with one implicit factory. */
export function createWorld(dataHash = ''): World {
  return {
    meta: { v: WORLD_VERSION, dataHash },
    factories: [createFactory(DEFAULT_FACTORY_ID, 'Factory')],
    groups: [],
    links: [],
    defaults: defaultWorldDefaults(),
    nodePool: {},
  };
}

export function clampTolerance(t: number): number {
  if (!Number.isFinite(t)) return TOLERANCE_DEFAULT;
  return Math.min(TOLERANCE_MAX, Math.max(TOLERANCE_MIN, t));
}

/**
 * The solver request for one factory on its own: defaults merged with the
 * factory's overrides. Link demand and link imports are added by world
 * resolution (`resolveWorld`); here only unassigned imports apply. `model`
 * supplies the map node counts that pool edits apply to. Every factory may
 * use up to the whole node pool; its resource limits come on top (A33).
 */
export function factorySolveRequest(
  world: World,
  model: Pick<Model, 'nodes'>,
  factoryId: string,
): SolveRequest {
  const factory = world.factories.find((f) => f.id === factoryId);
  if (!factory) throw new Error(`Unknown factory "${factoryId}".`);
  const d = world.defaults;
  const r = factory.request;
  const objectives = [...(r.objectives ?? d.objectives)];
  const imports = tweakedImports(factory).map((i) => ({ item: i.item, cap: i.cap ?? Infinity }));
  return {
    targets: r.targets.map((t) => ({ ...t })),
    objectives: objectives.length ? objectives : [...defaultWorldDefaults().objectives],
    tolerance: r.tolerance ?? d.tolerance,
    recipes: recipeFilter(world, factory),
    nodeBudget: nodeBudget(world, model),
    ...resourceLimits(factory),
    ...(imports.length ? { imports } : {}),
    ...((r.wholeMachines ?? d.wholeMachines) ? { wholeMachines: true } : {}),
    ...((r.costImports ?? d.costImports) ? { costImports: true } : {}),
  };
}

/**
 * The factory's recipe filter: its toggles over the world's, its alternates
 * and max-tier settings over the defaults, and its plan tweaks over all of
 * those (A35; `tweaks: false` leaves them out). Ids are sorted, so equal
 * settings give equal requests (and cache keys).
 */
export function recipeFilter(
  world: World,
  factory: Factory,
  options: { tweaks?: boolean } = {},
): RecipeFilter {
  const d = world.defaults;
  const r = factory.request;
  const toggles: Record<string, boolean> = { ...d.recipes, ...r.recipes };
  if (options.tweaks ?? true)
    for (const t of factory.tweaks) {
      if (t.kind === 'ban') toggles[t.recipe] = false;
      else if (t.kind === 'swap') {
        toggles[t.from] = false;
        toggles[t.to] = true;
      }
    }
  const ids = (on: boolean) =>
    Object.keys(toggles)
      .filter((id) => toggles[id] === on)
      .sort();
  const include = ids(true);
  const maxTier = r.maxTier === undefined ? d.maxTier : r.maxTier;
  return {
    alternates: r.alternates ?? d.alternates,
    exclude: ids(false),
    ...(include.length ? { include } : {}),
    ...(maxTier !== null ? { maxTier } : {}),
  };
}

/**
 * The factory's unassigned imports with its `import` tweaks applied: a
 * tweaked item is imported without a cap (A35). Order is kept, tweaked items
 * not already listed come last.
 */
export function tweakedImports(factory: Factory): UnassignedImport[] {
  const tweaked = new Set(factory.tweaks.flatMap((t) => (t.kind === 'import' ? [t.item] : [])));
  const out = factory.unassignedImports.map((i) =>
    tweaked.has(i.item) ? { item: i.item } : { ...i },
  );
  for (const item of tweaked) if (!out.some((i) => i.item === item)) out.push({ item });
  return out;
}

/** The factory's resource limits as solver limits: off is 0. Sorted, so equal settings give equal requests. */
function resourceLimits(factory: Factory): Pick<SolveRequest, 'resourceLimits'> {
  const limits: Record<string, number> = {};
  for (const item of Object.keys(factory.resources).sort()) {
    const l = factory.resources[item]!;
    if (!l.enabled) limits[item] = 0;
    else if (l.max !== undefined) limits[item] = l.max;
  }
  return Object.keys(limits).length ? { resourceLimits: limits } : {};
}

function nodeBudget(world: World, model: Pick<Model, 'nodes'>): 'pool' | Record<string, number> {
  if (Object.keys(world.nodePool).length === 0) return 'pool';
  return Object.fromEntries(model.nodes.map((n) => [n.id, world.nodePool[n.id] ?? n.count]));
}
