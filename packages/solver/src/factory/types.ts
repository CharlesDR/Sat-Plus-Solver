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

/** O1 and O2 (§3.3). O3–O6 and the lexicographic stack arrive in M4. */
export type ObjectiveId = 'resources' | 'scarcity';

export interface RecipeFilter {
  /** Include alternate recipes. Default true. */
  alternates?: boolean;
  /** Recipe ids to leave out. */
  exclude?: readonly string[];
}

export interface SolveRequest {
  /** What this factory must deliver. */
  targets: readonly ItemRate[];
  /** Extra demand from the world layer (outgoing link rates), added to targets (§3.2). */
  demand?: readonly ItemRate[];
  /** Imports: incoming links plus unassigned imports. Free under O1/O2. */
  imports?: readonly ImportCap[];
  objective?: ObjectiveId;
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
  /** Fractional machine count at the recipe's clock. */
  machines: number;
  /** Whole machines needed to build it. */
  machinesCeil: number;
  /** Total draw of these machines, fractional (negative = generation). */
  powerMW: number;
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
  | { code: 'time-limit'; severity: 'warning'; message: string }
  | { code: 'numerical'; severity: 'error'; message: string }
  | { code: 'check-failed'; severity: 'error'; message: string }
  | { code: 'invalid-request'; severity: 'error'; message: string };

export interface SolveStats {
  /** Recipes left after filters and pruning, and the LP size. */
  recipes: number;
  columns: number;
  rows: number;
}

export interface SolveResult {
  status: SolveStatus;
  objective: ObjectiveId;
  /** Value of the chosen objective (without the tie-break regularizer). */
  objectiveValue?: number;
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
