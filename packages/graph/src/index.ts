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
  importSuggestions,
  SUGGEST_MIN_RESOURCES,
  SUGGEST_MIN_SHARE,
  type ImportSuggestion,
} from './suggest';
export { PINCH_MAX, PINCH_MIN, PINCH_PREFIX, pinchAreas, type PinchArea } from './pinch';
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
  quietText,
  countText,
  SMALL_PLAN,
  wrapText,
} from './layout';
export { flowForm, GASES, type FlowForm } from './forms';
export { productionDepths, productionOrder, type OrderedRecipe } from './order';
export { COST_WEIGHTS, gap, layoutCost, layoutScore, type LayoutScore } from './score';
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
export { factoryNodeId, groupNodeId, MAX_OUT_PORTS, nestNodeId, worldGraph } from './world';
export type {
  CardItem,
  WorldEdge,
  WorldEdgeItem,
  WorldGraph,
  WorldGraphInput,
  WorldGraphOptions,
  WorldNode,
  WorldNodeKind,
  WorldPort,
} from './world';
export {
  absolutePosition,
  ACTION_ROW,
  GROUP_HEADER,
  layoutWorldGraph,
  MORE_PORT,
  PORT_ROW,
  portId,
  portY,
  worldEdgeLines,
  worldNodeLines,
} from './worldLayout';
export type { PlacedWorldEdge, PlacedWorldNode, WorldLayout } from './worldLayout';
