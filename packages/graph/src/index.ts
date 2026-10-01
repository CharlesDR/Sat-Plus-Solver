/**
 * @sps/graph — factory flowchart and world graph construction + layout.
 * Pure TypeScript; may depend only on solver/world result types.
 * See docs/ARCHITECTURE.md §7. The factory flowchart lands in M7, the world
 * graph in M8.
 */
export const PACKAGE_NAME = '@sps/graph';

export {
  allocate,
  byproductNodeId,
  factoryGraph,
  importNodeId,
  recipeNodeId,
  targetNodeId,
} from './factory';
export type {
  FactoryGraph,
  FlowchartInput,
  FlowEdge,
  FlowNode,
  FlowNodeKind,
  GraphLabels,
} from './factory';
export {
  CHAR_WIDTH,
  layoutFactoryGraph,
  LINE_HEIGHT,
  nodeLines,
  overlaps,
  rateText,
} from './layout';
export type {
  Box,
  FactoryLayout,
  LayoutEngine,
  LayoutOptions,
  PlacedEdge,
  PlacedNode,
} from './layout';
