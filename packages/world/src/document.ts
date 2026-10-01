/**
 * The `World` document (docs/ARCHITECTURE.md §4.1): the root of all app state
 * and the save/share format. Plain JSON data, so no `Infinity` or `undefined`
 * values that JSON can't carry. Any shape change bumps `WORLD_VERSION` and adds
 * a migration plus a migration test (CLAUDE.md).
 *
 * M3 used a single implicit factory; M5 resolves links and groups
 * (`resolveWorld`). v2 (M5) added the whole-machines and cost-imports toggles;
 * `migrateWorld` upgrades older documents.
 */
import type { Model } from '@sps/data';
import type { ItemRate, ObjectiveId, SolveRequest } from '@sps/solver';

export const WORLD_VERSION = 2;

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
  /** Recipe ids disabled everywhere. */
  excludeRecipes: string[];
}

/** Per-factory overrides of `WorldDefaults`; a missing field inherits. */
export interface FactoryRequest {
  targets: ItemRate[];
  objectives?: ObjectiveId[];
  tolerance?: number;
  alternates?: boolean;
  wholeMachines?: boolean;
  costImports?: boolean;
  excludeRecipes?: string[];
}

export interface UnassignedImport {
  item: string;
  /** Per minute; missing means unlimited. */
  cap?: number;
}

export interface Factory {
  id: string;
  name: string;
  groupId?: string;
  request: FactoryRequest;
  unassignedImports: UnassignedImport[];
  /** `'pool'` = up to the whole map pool; otherwise explicit caps per node id (missing = 0). */
  nodeBudget: 'pool' | Record<string, number>;
  priority: number;
  notes: string;
}

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
    objectives: ['resources'],
    tolerance: TOLERANCE_DEFAULT,
    alternates: false,
    wholeMachines: false,
    costImports: false,
    excludeRecipes: [],
  };
}

export function createFactory(id: string, name: string): Factory {
  return {
    id,
    name,
    request: { targets: [] },
    unassignedImports: [],
    nodeBudget: 'pool',
    priority: 0,
    notes: '',
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
 * supplies the map node counts that pool edits apply to.
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
  const exclude = [...new Set([...d.excludeRecipes, ...(r.excludeRecipes ?? [])])].sort();
  const imports = factory.unassignedImports.map((i) => ({ item: i.item, cap: i.cap ?? Infinity }));
  return {
    targets: r.targets.map((t) => ({ ...t })),
    objectives: objectives.length ? objectives : ['resources'],
    tolerance: r.tolerance ?? d.tolerance,
    recipes: { alternates: r.alternates ?? d.alternates, exclude },
    nodeBudget: nodeBudget(world, model, factory),
    ...(imports.length ? { imports } : {}),
    ...((r.wholeMachines ?? d.wholeMachines) ? { wholeMachines: true } : {}),
    ...((r.costImports ?? d.costImports) ? { costImports: true } : {}),
  };
}

function nodeBudget(
  world: World,
  model: Pick<Model, 'nodes'>,
  factory: Factory,
): 'pool' | Record<string, number> {
  if (factory.nodeBudget !== 'pool') return { ...factory.nodeBudget };
  if (Object.keys(world.nodePool).length === 0) return 'pool';
  return Object.fromEntries(model.nodes.map((n) => [n.id, world.nodePool[n.id] ?? n.count]));
}
