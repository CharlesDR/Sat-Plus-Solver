/**
 * Backend-neutral LP/MILP description. Only `@sps/solver` builds these; the
 * concrete solver (HiGHS) is reached through `LpBackend` (CLAUDE.md).
 */

export interface LpTerm {
  var: string;
  coef: number;
}

export interface LpVariable {
  name: string;
  /** Default 0. Use `-Infinity` for free variables. */
  lo?: number;
  /** Default +Infinity. */
  hi?: number;
  integer?: boolean;
}

export interface LpConstraint {
  name: string;
  terms: LpTerm[];
  lo?: number;
  hi?: number;
}

export interface LpModel {
  sense: 'min' | 'max';
  objective: LpTerm[];
  variables: LpVariable[];
  constraints: LpConstraint[];
}

export type LpStatus =
  | 'optimal'
  | 'infeasible'
  | 'unbounded'
  | 'infeasible-or-unbounded'
  | 'time-limit'
  | 'iteration-limit'
  | 'error';

export interface LpSolution {
  status: LpStatus;
  /** Backend's own status text, for diagnostics. */
  rawStatus: string;
  objective?: number;
  /** Variable values by name (present when the backend has a solution). */
  values?: Map<string, number>;
  /** Row duals by constraint name (LP only). */
  duals?: Map<string, number>;
  /** Relative MIP gap of the returned solution (MILP only): 0 when proved optimal. */
  gap?: number;
}

export interface LpOptions {
  /** Wall-clock limit for one solve, in seconds. */
  timeLimitSeconds?: number;
  /** MILP only: a candidate solution by variable name (missing = 0). The backend checks it and ignores it if infeasible. */
  start?: ReadonlyMap<string, number>;
  /**
   * MILP only: row feasibility tolerance, absolute. The backend default
   * (HiGHS 1e-6) is fast but can "meet" a demand of MIN_RATE by building
   * nothing; the solver retries with a tighter value when that happens.
   */
  mipFeasibilityTolerance?: number;
}

export interface LpBackend {
  solve(model: LpModel, options?: LpOptions): Promise<LpSolution>;
}
