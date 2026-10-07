/**
 * World-layer result types (docs/ARCHITECTURE.md §4.3–4.5). Units as in the
 * solver: items/min, fluids m³/min, power MW (positive = consumption).
 */
import type { NodePurity } from '@sps/data';
import type { ItemRate, PowerSummary, SolveRequest, SolveResult, SolveStatus } from '@sps/solver';
import type { Link, ManualEntry } from './document';

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
  /** Memoization key of `request` (§4.3 step 5); `manual` in manual mode. */
  key: string;
  /** In manual mode (A36), the plan's arithmetic as a result: not solver-checked. */
  result: SolveResult;
  /**
   * Manual mode (A36): what the plan needs beyond its import caps, and what
   * each target gets (a target can come up short), both sorted by item.
   */
  manual?: { missing: ItemRate[]; targets: ItemRate[] };
  /** The plan as recipe groups (A36 entries), sorted; empty when it has no plan. What "Mark as built" stores. */
  plan: ManualEntry[];
  /** Build mark check (A44, §4.8), when the factory is marked as built. */
  build?: BuildCheck;
}

/** Recipe group counts, built and now: machines, or whole buildings with whole machines on (A44). */
export interface RecipeChange {
  recipe: string;
  built: number;
  now: number;
}

/** One deficit between a factory's build mark and today's world (A44, §4.8). */
export type BuildFlag =
  /** Can't get enough inputs: needed beyond what links and imports supply. */
  | { kind: 'inputs-short'; severity: 'error'; items: ItemRate[] }
  /** The build makes less than its targets and links ask for: short per item. */
  | { kind: 'needs-expansion'; severity: 'error'; items: ItemRate[] }
  /** The build extracts more than the factory's resource limit allows. */
  | {
      kind: 'over-resource-limit';
      severity: 'error';
      items: { item: string; rate: number; limit: number }[];
    }
  /** Built recipes no longer in the game data. */
  | { kind: 'recipe-gone'; severity: 'error'; recipes: string[] }
  /** Today's plan adds groups or machines the build lacks. */
  | { kind: 'plan-changed'; severity: 'warning'; changes: RecipeChange[] }
  /** Today's plan only needs fewer machines or fewer groups. */
  | { kind: 'can-reduce'; severity: 'info'; changes: RecipeChange[] }
  /** The game data changed since the mark. */
  | { kind: 'data-changed'; severity: 'info' };

/** What changed since a factory was marked as built. */
export type BuildCause = 'factory-settings' | 'world-settings' | 'links' | 'game-data';

/**
 * A marked factory's check (A44): `matches` with no flags, `note` with info
 * only, `differs` with a warning, `broken` when the build can't run.
 */
export interface BuildCheck {
  state: 'matches' | 'note' | 'differs' | 'broken';
  /** Worst first. */
  flags: BuildFlag[];
  causes: BuildCause[];
  markedAt: string;
}

export interface LinkResult {
  id: string;
  from: string;
  to: string;
  item: string;
  mode: 'fixed' | 'pull';
  /** What the producer was asked for: the fixed rate, or the resolved pull rate. */
  requested: number;
  /**
   * What the producer ships: `requested` when it solved, else 0. A manual
   * factory (A36) ships what its plan has left after its targets.
   */
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
  | (Diag & { code: 'import-cost-unsettled'; factories: string[] })
  | (Diag & { code: 'build-drift'; factory: string; state: 'differs' | 'broken' })
  | (Diag & {
      code: 'manual-short';
      factory: string;
      /** Inputs needed beyond the import caps. */
      missing: ItemRate[];
      /** Targets the plan doesn't fully make: what each is short by. */
      targets: ItemRate[];
    });

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
