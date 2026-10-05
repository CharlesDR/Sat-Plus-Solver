/**
 * World-layer result types (docs/ARCHITECTURE.md §4.3–4.5). Units as in the
 * solver: items/min, fluids m³/min, power MW (positive = consumption).
 */
import type { NodePurity } from '@sps/data';
import type { ItemRate, PowerSummary, SolveRequest, SolveResult, SolveStatus } from '@sps/solver';
import type { Link } from './document';

/** Solves one factory; injected so the world layer never sees the LP backend (§7). */
export type SolveFactory = (request: SolveRequest) => Promise<SolveResult>;

/**
 * `ok`: solved, and every incoming link delivers what it draws. `short`:
 * solved, but an upstream factory failed, so a link it draws on is short.
 * `infeasible`: the factory's own solve failed (any status but `ok`).
 */
export type FactoryStatus = 'ok' | 'short' | 'infeasible';

/**
 * One item's flows in a scope (a factory, a group or the save). Conservation:
 * `produced − consumed + imported + unmet = target + exported + surplus`.
 * `imported`/`exported` are link deliveries crossing the scope's boundary;
 * links inside it cancel out.
 */
export interface LedgerRow {
  item: string;
  produced: number;
  consumed: number;
  /** Targets the scope's solved factories deliver (link demand excluded). */
  target: number;
  imported: number;
  exported: number;
  /**
   * Available supply: byproducts and free disposal, plus a fixed link's
   * delivery its consumer doesn't use. No link draws on it, so all of it is
   * also overproduction.
   */
  surplus: number;
  /** Demand nobody in the save supplies: unassigned imports plus short links. */
  unmet: number;
}

export interface NodeUse {
  node: string;
  used: number;
}

/** What any scope adds up to. */
export interface ScopeTotals {
  /** Items with any flow, sorted by id. */
  ledger: LedgerRow[];
  power: PowerSummary;
  /** Node classes in use, sorted by id. */
  nodes: NodeUse[];
  /** Whole machines to build (Σ `machinesCeil`). */
  machines: number;
}

export interface FactoryResult extends ScopeTotals {
  id: string;
  /** Raw resources its plan extracts, sorted by item (A33). */
  extraction: ItemRate[];
  name: string;
  groupId?: string;
  status: FactoryStatus;
  /** The effective request: defaults, overrides, link demand and link imports. */
  request: SolveRequest;
  /** Memoization key of `request` (§4.3 step 5). */
  key: string;
  result: SolveResult;
}

export interface LinkResult {
  id: string;
  from: string;
  to: string;
  item: string;
  mode: 'fixed' | 'pull';
  /** What the producer was asked for: the fixed rate, or the resolved pull rate. */
  requested: number;
  /** What the producer ships: `requested` when it solved, else 0. */
  delivered: number;
  /** What the consumer's plan draws through this link. */
  used: number;
  /** `requested − delivered`. */
  short: number;
  transport?: Link['transport'];
  /** Belts or pipes needed: `ceil(requested / capacity)`, when the tier's capacity is known. */
  carriers?: number;
}

export interface NodePoolRow {
  node: string;
  resource: string;
  purity: NodePurity;
  /** Map count, or the world's `nodePool` edit. */
  pool: number;
  used: number;
  /** Per factory using it, sorted by factory id. */
  byFactory: { factory: string; used: number }[];
  /** Used beyond the pool: a warning, not a constraint (A9). */
  overAllocated: boolean;
}

export interface GroupResult extends ScopeTotals {
  id: string;
  name: string;
  parentId?: string;
  /** Every descendant factory, sorted. */
  factories: string[];
  /** Links between two of its factories: hidden when the group is collapsed. */
  internalLinks: string[];
  /** Links crossing its boundary. */
  boundaryLinks: string[];
}

export interface WorldPower extends PowerSummary {
  /** max(0, net): what "size power plant" closes (single grid, A8). */
  deficitMW: number;
}

interface Diag {
  severity: 'error' | 'warning';
  message: string;
}

export type WorldDiagnostic =
  | (Diag & { code: 'invalid-link'; link: string })
  | (Diag & { code: 'invalid-group'; group: string; factory?: string })
  | (Diag & { code: 'factory-failed'; factory: string; status: SolveStatus })
  | (Diag & { code: 'link-short'; link: string; item: string; deficit: number })
  | (Diag & {
      code: 'cycle-not-converged';
      factories: string[];
      links: string[];
      iterations: number;
    })
  | (Diag & { code: 'node-over-allocated'; node: string; used: number; pool: number })
  | (Diag & { code: 'import-cost-unsettled'; factories: string[] });

export interface WorldStats {
  /** Calls to `solveFactory` during this resolve (cache misses). */
  solves: number;
  cacheHits: number;
  /** Resolution passes: 1, or more while linked import costs settle. */
  passes: number;
}

export interface WorldResult extends Omit<ScopeTotals, 'power'> {
  /** Sorted by id. */
  factories: FactoryResult[];
  links: LinkResult[];
  groups: GroupResult[];
  power: WorldPower;
  /** Every node class of the model, sorted by id. */
  nodePool: NodePoolRow[];
  diagnostics: WorldDiagnostic[];
  stats: WorldStats;
}
