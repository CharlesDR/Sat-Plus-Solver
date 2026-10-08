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
  subFactoryNodeId,
  targetNodeId,
} from './factory';
export type {
  FactoryGraph,
  FlowchartInput,
  FlowEdge,
  FlowNode,
  FlowNodeKind,
  GraphArea,
  GraphLabels,
  SubFactoryFlow,
} from './factory';
export {
  AREA_MIN_NODES,
  areaNodeId,
  defaultAreas,
  groupAreas,
  type AreaCatalog,
  type AreaSettings,
} from './areas';
export {
  AREA_TITLE,
  areaStats,
  CHAR_WIDTH,
  elkOptions,
  ICON_GAP,
  layoutFactoryGraph,
  LINE_HEIGHT,
  nodeLines,
  nodeText,
  overlaps,
  isRaw,
  LABEL_ICON_GAP,
  multiStageInputs,
  TRAY_PAD,
  rateText,
  SMALL_PLAN,
  wrapText,
} from './layout';
export { flowForm, GASES, type FlowForm } from './forms';
export { gap, layoutScore, type LayoutScore } from './score';
export type {
  Box,
  Bundle,
  FactoryLayout,
  LayoutEngine,
  LayoutOptions,
  NodePort,
  NodeText,
  PlacedArea,
  PlacedEdge,
  PlacedNode,
  TrayRow,
} from './layout';
export { factoryNodeId, groupNodeId, nestNodeId, worldGraph } from './world';
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
