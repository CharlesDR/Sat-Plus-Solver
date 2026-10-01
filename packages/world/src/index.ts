/**
 * @sps/world — world layer: factories, groups, links, resolution, ledgers.
 * Pure TypeScript; depends on the solver's public API only.
 * See docs/ARCHITECTURE.md §4. The `World` document lands in M3 (the web store
 * holds it); links, resolution, ledgers and groups are implemented in M5.
 */
export const PACKAGE_NAME = '@sps/world';
export * from './document';
