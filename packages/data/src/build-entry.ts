/**
 * @sps/data/build — Node-only pipeline: raw SF+ JSON → validated model + report.
 */
export { buildModel, nodeId, MAX_FLUID_RATE } from './build';
export type { BuildInputs, BuildResult, BuildDetails } from './build';
export type { Issue, Severity } from './issues';
export { renderReport } from './report';
export type { ReportSection } from './report';
