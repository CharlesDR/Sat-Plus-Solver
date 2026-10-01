/**
 * @sps/solver — factory layer: LP/MILP model builder, objectives, diagnostics.
 * Pure TypeScript; reaches HiGHS only via the LpBackend interface.
 * See docs/ARCHITECTURE.md §3 and §5. The LP plumbing and the build-time
 * free-lunch check land in M1; the factory solver (O1/O2) in M2, O3–O6 in M4.
 */
export type {
  LpBackend,
  LpConstraint,
  LpModel,
  LpOptions,
  LpSolution,
  LpStatus,
  LpTerm,
  LpVariable,
} from './lp/types';
export { toLpText } from './lp/lpFormat';
export { createHighsBackend } from './lp/highs';
export { findFreeLunch } from './checks/freeLunch';
export type { FreeLunchResult } from './checks/freeLunch';
export { solve } from './factory/solve';
export type * from './factory/types';
export { summarizePlan, formatRate } from './factory/summary';
export type { PlanSummary, SummaryFlow, SummaryNode, SummaryRecipe } from './factory/summary';
