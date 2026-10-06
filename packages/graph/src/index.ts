/**
 * @sps/graph — factory flowchart and world graph construction + layout.
 * Pure TypeScript; may depend only on solver/world result types.
 * See docs/ARCHITECTURE.md §7. The factory flowchart lands in M7, the world
 * graph in M8 (`worldGraph`, `layoutWorldGraph`).
 */
export const PACKAGE_NAME = '@sps/graph';

export {
  allocate,
  byproductNodeId,
  factoryGraph,
  importNodeId,
  missingNodeId,
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
  ICON_GAP,
  layoutFactoryGraph,
  LINE_HEIGHT,
  nodeLines,
  nodeText,
  overlaps,
  rateText,
  wrapText,
} from './layout';
export type {
  Box,
  FactoryLayout,
  LayoutEngine,
  LayoutOptions,
  NodeText,
  PlacedEdge,
  PlacedNode,
} from './layout';
export { factoryNodeId, groupNodeId, worldGraph } from './world';
export type {
  StubItem,
  WorldEdge,
  WorldEdgeItem,
  WorldGraph,
  WorldGraphInput,
  WorldGraphOptions,
  WorldNode,
  WorldNodeKind,
} from './world';
export {
  absolutePosition,
  ACTION_ROW,
  GROUP_HEADER,
  layoutWorldGraph,
  worldEdgeLines,
  worldNodeLines,
} from './worldLayout';
export type { PlacedWorldEdge, PlacedWorldNode, WorldLayout } from './worldLayout';
