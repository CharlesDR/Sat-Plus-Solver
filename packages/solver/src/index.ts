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
export { createHighsBackend } from './lp/highs';
export { findFreeLunch } from './checks/freeLunch';
export type { FreeLunchResult } from './checks/freeLunch';
export {
  FARM_CAP,
  MIN_RATE,
  objectiveStack,
  createSolver,
  solve,
  usageWeights,
} from './factory/solve';
export type { CostCacheEntry, Solver } from './factory/solve';
export { OBJECTIVE_IDS } from './factory/types';
export { filterMinerRoutes, minerFluidOptions } from './factory/minerFluids';
export type { MinerFluidOptions, MinerFluids, MinerFluidSupply } from './factory/minerFluids';
export { aboveTier, compareTiers, parseTier, recipeExclusion } from './factory/recipes';
export { producible } from './factory/reachability';
export { bestNodeRates, rawResources } from './factory/resources';
export type { RawResource } from './factory/resources';
export { compareAlternates } from './factory/alternates';
export type { AlternatesReport } from './factory/alternates';
export type * from './factory/types';
export {
  summarizePlan,
  recipeTable,
  alternateMark,
  buildBill,
  mergeBills,
  buildingTable,
  materialTable,
  wholeBuildings,
  starterNote,
  PRECISE_NUMBERS,
  QUIET_NUMBERS,
} from './factory/summary';
export { formatExact, formatQuiet, formatRate, groupThousands } from './factory/numbers';
export type {
  BuildBill,
  NumberFormat,
  PlanSummary,
  SummaryAmount,
  SummaryBuilding,
  SummaryMaterial,
  SummaryFlow,
  SummaryItem,
  SummaryNode,
  SummaryRecipe,
} from './factory/summary';
export { sizeNetwork } from './network/size';
export type { Network, NetworkEdge, NetworkFlow, NetworkNode, NetworkSizing } from './network/size';
