/**
 * @sps/graph — factory flowchart and world graph construction + layout.
 * Pure TypeScript; may depend only on solver/world result types.
 * See docs/ARCHITECTURE.md §7. The factory flowchart lands in M7, the world
 * graph in M8 (`worldGraph`, `layoutWorldGraph`).
 */
export const PACKAGE_NAME = '@sps/graph';

export {
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
  GraphArea,
  GraphLabels,
  SubFactoryFlow,
} from './factory';
export { areaNodeId, groupAreas, type AreaCatalog, type AreaSettings } from './areas';
export { importSuggestions, type ImportSuggestion } from './suggest';

export {
  AREA_TITLE,
  areaStats,
  layoutFactoryGraph,
  nodeLines,
  overlaps,
  rateText,
  quietText,
  countText,
} from './layout';
export { flowForm, GASES, type FlowForm } from './forms';
export { productionOrder, type OrderedRecipe } from './order';
export { layoutScore, type LayoutScore } from './score';
export type {
  Box,
  FactoryLayout,
  LayoutEngine,
  LayoutOptions,
  NodePort,
  PlacedArea,
  PlacedEdge,
  PlacedNode,
} from './layout';
export { worldGraph } from './world';
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
export { layoutWorldGraph, MORE_PORT, PORT_ROW, portY, worldNodeLines } from './worldLayout';
export type { PlacedWorldEdge, PlacedWorldNode, WorldLayout } from './worldLayout';
