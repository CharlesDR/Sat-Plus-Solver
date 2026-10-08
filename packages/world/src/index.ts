/**
 * @sps/world — world layer: factories, groups, links, resolution, ledgers.
 * Pure TypeScript; depends on the solver's public API only, and reaches the
 * solver through an injected `solveFactory`. See docs/ARCHITECTURE.md §4.
 */
export const PACKAGE_NAME = '@sps/world';
export * from './document';
export * from './editing';
export * from './migrate';
export * from './persist';
export {
  COST_PASSES,
  CYCLE_ITERATION_LIMIT,
  CYCLE_TOLERANCE,
  DEFAULT_PIPE_CAPACITIES,
  resolveWorld,
  type ResolveOptions,
  type ResolveProgress,
} from './resolve';
export { createSolveCache, hashString, solveKey, stableStringify, type SolveCache } from './hash';
export { allocateRemaining, sizePowerPlant, SIZE_POWER_ITERATIONS } from './helpers';
export type * from './types';
export {
  discardManual,
  enterManual,
  leaveManual,
  manualEntries,
  manualOutcome,
  revertManual,
  setManualCount,
  undoManual,
  type ManualOutcome,
} from './manual';
export {
  BUILD_FLAG_LABELS,
  buildFingerprint,
  checkBuild,
  clearBuilt,
  markAllBuilt,
  markBuilt,
  planEntries,
  restoreBuild,
  type BuildNow,
  type BuildSource,
} from './built';
export * from './modeler';
