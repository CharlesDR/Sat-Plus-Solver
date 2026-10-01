/**
 * @sps/world — world layer: factories, groups, links, resolution, ledgers.
 * Pure TypeScript; depends on the solver's public API only, and reaches the
 * solver through an injected `solveFactory`. See docs/ARCHITECTURE.md §4.
 */
export const PACKAGE_NAME = '@sps/world';
export * from './document';
export * from './migrate';
export {
  COST_PASSES,
  CYCLE_ITERATION_LIMIT,
  CYCLE_TOLERANCE,
  resolveWorld,
  type ResolveOptions,
} from './resolve';
export { createSolveCache, hashString, solveKey, stableStringify, type SolveCache } from './hash';
export { allocateRemaining, sizePowerPlant, SIZE_POWER_ITERATIONS } from './helpers';
export type * from './types';
