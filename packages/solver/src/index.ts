/**
 * @sps/solver — factory layer: LP/MILP model builder, objectives, diagnostics.
 * Pure TypeScript; reaches HiGHS only via the LpBackend interface.
 * See docs/ARCHITECTURE.md §3 and §5. The LP plumbing and the build-time
 * free-lunch check land in M1; the factory solver (O1/O2) in M2, O3–O6 and the
 * lexicographic stack in M4.
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
export {
  clampTolerance,
  DEFAULT_TOLERANCE,
  LEX_EPSILON,
  MAX_TOLERANCE,
  MILP_TIME_LIMIT_SECONDS,
  MIN_BRANCH,
  MIN_RATE,
  MIN_TOLERANCE,
  objectiveStack,
  solve,
} from './factory/solve';
export { OBJECTIVE_IDS } from './factory/types';
export {
  aboveTier,
  compareTiers,
  DEFAULT_ALTERNATES,
  filterRecipes,
  parseTier,
  recipeExclusion,
} from './factory/recipes';
export { bestNodeRates, extractionOf, rawResources } from './factory/resources';
export type { RawResource } from './factory/resources';
export { compareAlternates } from './factory/alternates';
export type { AlternatesReport } from './factory/alternates';
export type * from './factory/types';
export { summarizePlan, formatRate, recipeTable } from './factory/summary';
export type { PlanSummary, SummaryFlow, SummaryNode, SummaryRecipe } from './factory/summary';
