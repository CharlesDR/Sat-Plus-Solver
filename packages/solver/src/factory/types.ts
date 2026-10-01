/**
 * Factory-layer request and result types (docs/ARCHITECTURE.md §3).
 * Units: items/min, fluids m³/min, power MW (positive = consumption).
 */

export interface ItemRate {
  item: string;
  /** Per minute (MW for the `mw` item). */
  rate: number;
}

export interface ImportCap {
  item: string;
  /** Upper bound on the import, per minute. `Infinity` for unlimited. */
  cap: number;
}

/**
 * The six objectives of §3.3: O1 `resources`, O2 `scarcity`, O3 `machines`,
 * O4 `power` (machine draw only; turbines an earlier stage runs are credited, A16), O5 `output`
 * (maximize), O6 `resourceTypes` (MILP).
 */
export type ObjectiveId =
  'resources' | 'scarcity' | 'machines' | 'power' | 'output' | 'resourceTypes';

export const OBJECTIVE_IDS: readonly ObjectiveId[] = [
  'resources',
  'scarcity',
  'machines',
  'power',
  'output',
  'resourceTypes',
];

export interface RecipeFilter {
  /** Include alternate recipes. Default false (`DEFAULT_ALTERNATES`); `compareAlternates` shows which would help. */
  alternates?: boolean;
  /** Recipe ids to leave out. Wins over `include`. */
  exclude?: readonly string[];
  /** Alternate recipe ids to allow even when `alternates` is off. */
  include?: readonly string[];
  /**
   * Leave out recipes above this dataset tier (`"<major>-<minor>"`, compared
   * major first). Tier `0-0` recipes are never left out (A23).
   */
  maxTier?: string;
}

export interface SolveRequest {
  /** What this factory must deliver. */
  targets: readonly ItemRate[];
  /** Extra demand from the world layer (outgoing link rates), added to targets (§3.2). */
  demand?: readonly ItemRate[];
  /** Imports: incoming links plus unassigned imports. Free under O1/O2. */
  imports?: readonly ImportCap[];
  /** A one-objective stack. Use `objectives` for more; not both. Default `resources`. */
  objective?: ObjectiveId;
  /**
   * Lexicographic stack (§3.3): each objective is solved in order and held
   * within `tolerance` of its optimum for the next. No repeats; `output` may
   * only come first. Default `['resources']`.
   */
  objectives?: readonly ObjectiveId[];
  /** Relative tolerance per stage, a fraction in [MIN_TOLERANCE, MAX_TOLERANCE]. Default 0.0001 (0.01%). */
  tolerance?: number;
  /** Whole machines (§3.4): adds integer machine counts, making the solve a MILP. */
  wholeMachines?: boolean;
  /**
   * Cost imported inputs (§3.3): each import carries the cost of making 1/min
   * of it in a standalone plan under this stack, from the map pool.
   */
  costImports?: boolean;
  /**
   * With `costImports`: embodied costs given for some imports, used as they
   * are instead of a standalone plan. The world layer passes the upstream
   * factory's marginal costs here for linked imports (§3.3, A18).
   */
  importCosts?: readonly ImportCost[];
  /**
   * Also report the marginal cost of these delivered items under these
   * objectives (`SolveResult.marginalCosts`): what a linked consumer is
   * charged per 1/min (§3.3, A18).
   */
  marginalCosts?: { items: readonly string[]; objectives: readonly ObjectiveId[] };
  /** O2 weight per resource item id, replacing 1 / map-total NNE. Must be ≥ 0. */
  scarcityWeights?: Readonly<Record<string, number>>;
  recipes?: RecipeFilter;
  /** `'pool'` (default) caps each node class at its map count; a record gives explicit caps (missing = 0). */
  nodeBudget?: 'pool' | Readonly<Record<string, number>>;
}

export type SolveStatus = 'ok' | 'unreachable' | 'infeasible' | 'unbounded' | 'error';

export interface RecipeUsage {
  id: string;
  name: string;
  machine: string;
  /**
   * Fractional machine count at the recipe's clock. Heaters (A17): the whole
   * heater count, which burns full fuel and emits full exhaust.
   */
  machines: number;
  /** Whole machines needed to build it (the solved integer count in whole-machines mode and for heaters). */
  machinesCeil: number;
  /** Total draw of these machines, fractional (negative = generation). */
  powerMW: number;
  /**
   * Heaters only (A17): boiler-side throughput as a fraction of the heaters'
   * boiler capacity, 0–1. Boiler flows are `rate × machines × boilerLoad`.
   */
  boilerLoad?: number;
}

export interface ItemFlow {
  item: string;
  produced: number;
  consumed: number;
  imported: number;
  surplus: number;
  /** Targets plus world demand. */
  demand: number;
}

export interface NodeUsage {
  node: string;
  used: number;
  budget: number;
  /** used × NNE. */
  nne: number;
}

export interface PowerSummary {
  /** Sum of machine draw, MW. */
  consumptionMW: number;
  /** Sum of generation, MW (positive number). */
  generationMW: number;
  /** consumption − generation. */
  netMW: number;
}

export type Relaxation =
  { kind: 'node'; node: string; amount: number } | { kind: 'import'; item: string; amount: number };

export type Diagnostic =
  | {
      code: 'unreachable';
      severity: 'error';
      item: string;
      message: string;
      /** Disabled recipes that would make the item producible, closest first. */
      fixes: string[];
    }
  | { code: 'infeasible'; severity: 'error'; message: string; relaxations: Relaxation[] }
  | {
      code: 'unbounded';
      severity: 'error';
      message: string;
      /** LP variables that hit the sanity cap: `recipe:<id>`, `import:<item>` or `surplus:<item>`. */
      directions: string[];
    }
  | {
      code: 'time-limit';
      severity: 'warning';
      message: string;
      /** Relative MIP gap of the returned plan, when the stage was a MILP. */
      gap?: number;
    }
  | { code: 'tolerance-relaxed'; severity: 'warning'; message: string; tolerance: number }
  | { code: 'import-cost'; severity: 'warning'; item: string; message: string }
  | { code: 'numerical'; severity: 'error'; message: string }
  | { code: 'check-failed'; severity: 'error'; message: string }
  | { code: 'invalid-request'; severity: 'error'; message: string };

export interface SolveStats {
  /** Recipes left after filters and pruning, and the LP size. */
  recipes: number;
  columns: number;
  rows: number;
}

/** One solved stage of the lexicographic stack. */
export interface StageResult {
  objective: ObjectiveId;
  /** The objective's value on the returned plan (without the tie-break regularizer). */
  value: number;
  /** The stage's own optimum, which later stages were held within tolerance of. */
  optimum: number;
  /** Relative MIP gap when the stage was a time-limited MILP; 0 or absent otherwise. */
  gap?: number;
}

/** Embodied cost of an import (§3.3, A18), from its standalone plan at the imported rate. */
export interface ImportCost {
  item: string;
  /** The rate the cost was computed at: what the plan imports (1/min if it imports none). */
  rate: number;
  /** Cost per 1/min at `rate`, under each objective of the stack (`output` excluded). */
  cost: Partial<Record<ObjectiveId, number>>;
  /** Node resources its standalone plan uses: what it brings in under O6. */
  resourceTypes: string[];
}

export interface SolveResult {
  status: SolveStatus;
  /** The primary objective (the stack's first). */
  objective: ObjectiveId;
  /** Value of the primary objective on the returned plan (without the tie-break regularizer). */
  objectiveValue?: number;
  /** The whole stack, in order. */
  objectives: ObjectiveId[];
  /** One entry per stack objective, once the plan is solved. */
  stages: StageResult[];
  /** O5: the scale reached, targets × scale is what the plan delivers. */
  outputScale?: number;
  /** With `costImports`: the embodied cost per import, sorted by item. */
  importCosts?: ImportCost[];
  /**
   * With `request.marginalCosts`: per requested item the plan handles, its
   * marginal cost per 1/min under each requested objective, sorted by item.
   * Each is the dual of the item's balance row in an LP of that objective
   * alone, with the plan's heater (and other integer) counts fixed (A18), so
   * a whole heater's fuel stays charged to the factory that builds it.
   * `rate` is the item's demand in this plan; `resourceTypes` are the node
   * resources the plan uses.
   */
  marginalCosts?: ImportCost[];
  /** Recipes with a positive machine count, sorted by id. */
  recipes: RecipeUsage[];
  /** Every item that moves, sorted by id. */
  items: ItemFlow[];
  imports: ItemRate[];
  /** Byproducts and free disposal; at the world level this is available supply. */
  surplus: ItemRate[];
  /** Node classes in use, sorted by id. */
  nodes: NodeUsage[];
  power: PowerSummary;
  diagnostics: Diagnostic[];
  stats: SolveStats;
}
