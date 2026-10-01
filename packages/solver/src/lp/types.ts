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
}

export interface LpOptions {
  timeLimitSeconds?: number;
}

export interface LpBackend {
  solve(model: LpModel, options?: LpOptions): Promise<LpSolution>;
}
