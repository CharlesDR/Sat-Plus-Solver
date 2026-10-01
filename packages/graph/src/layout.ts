/**
 * ELK layered layout of a factory flowchart (docs/ARCHITECTURE.md §8).
 *
 * The ELK engine is injected: the web app runs it in its own worker, tests
 * run the bundled engine in Node. Node and label sizes are estimated from
 * their text, never measured, and ELK runs with a fixed seed, so identical
 * graphs always get identical coordinates.
 */
import type { ElkExtendedEdge, ElkLabel, ElkNode, ElkPoint } from 'elkjs/lib/elk-api';
import type { FactoryGraph, FlowEdge, FlowNode, FlowNodeKind } from './factory';

/** What `layoutFactoryGraph` needs from ELK (the `ELK` instance's `layout`). */
export interface LayoutEngine {
  layout(graph: ElkNode): Promise<ElkNode>;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PlacedNode = FlowNode & Box;

export interface PlacedEdge extends FlowEdge {
  /** The routed polyline, start to end (orthogonal segments). */
  points: ElkPoint[];
  label: Box & { text: string };
}

export interface FactoryLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

export interface LayoutOptions {
  /** Edge label text. Default: rate and item name. */
  edgeLabel?: (e: FlowEdge) => string;
  /** Text lines of a node, used to size it. Default: `nodeLines`. */
  nodeLines?: (n: FlowNode) => string[];
}

/** Estimated text metrics of the flowchart's 12px UI font. */
export const CHAR_WIDTH = 7;
export const LINE_HEIGHT = 16;
const PADDING_X = 12;
const PADDING_Y = 8;
const MIN_NODE_WIDTH = 120;
const MAX_NODE_CHARS = 44;

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.randomSeed': '1',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.spacing.nodeNode': '24',
  'elk.spacing.edgeNode': '16',
  'elk.spacing.edgeEdge': '8',
  'elk.spacing.edgeLabel': '4',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.layered.spacing.edgeNodeBetweenLayers': '16',
  // Network-simplex placement takes minutes on a 150-node plan; Brandes–Köpf
  // and a lighter crossing sweep keep it well under the 2 s budget (PLAN M7).
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.thoroughness': '3',
  'elk.padding': '[top=16,left=16,bottom=16,right=16]',
};

const LAYER: Partial<Record<FlowNodeKind, string>> = {
  import: 'FIRST',
  target: 'LAST',
  byproduct: 'LAST',
};

/** Compact rate: up to 3 decimals, 3 significant digits below 0.001. */
export function rateText(n: number): string {
  if (n !== 0 && Math.abs(n) < 0.001) return n.toPrecision(3);
  return String(Math.round(n * 1000) / 1000);
}

/** The text lines a node shows, which also size it. */
export function nodeLines(n: FlowNode): string[] {
  switch (n.kind) {
    case 'recipe':
    case 'resource': {
      const count = `${rateText(n.machines ?? 0)} × ${n.machine ?? ''}`;
      const boiler = n.boilerLoad !== undefined ? [`boiler ${rateText(n.boilerLoad * 100)}%`] : [];
      return [n.label, count, ...boiler];
    }
    case 'import':
      return [`Import: ${n.label}`, `${rateText(n.rate ?? 0)}/min`];
    case 'target':
      return [`Target: ${n.label}`, `${rateText(n.rate ?? 0)}/min`];
    case 'byproduct':
      return [`Byproduct: ${n.label}`, `${rateText(n.rate ?? 0)}/min`];
  }
}

const defaultEdgeLabel = (e: FlowEdge) => `${rateText(e.rate)} ${e.itemName}`;

const textWidth = (lines: readonly string[]) =>
  Math.min(MAX_NODE_CHARS, Math.max(0, ...lines.map((l) => l.length))) * CHAR_WIDTH;

/** Lays the flowchart out left to right: imports first, targets and byproducts last. */
export async function layoutFactoryGraph(
  graph: FactoryGraph,
  engine: LayoutEngine,
  options: LayoutOptions = {},
): Promise<FactoryLayout> {
  const lines = options.nodeLines ?? nodeLines;
  const edgeLabel = options.edgeLabel ?? defaultEdgeLabel;
  const texts = new Map(graph.edges.map((e) => [e.id, edgeLabel(e)]));
  const input: ElkNode = {
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: graph.nodes.map((n) => {
      const l = lines(n);
      const layer = LAYER[n.kind];
      return {
        id: n.id,
        width: Math.max(MIN_NODE_WIDTH, textWidth(l) + 2 * PADDING_X),
        height: l.length * LINE_HEIGHT + 2 * PADDING_Y,
        ...(layer ? { layoutOptions: { 'elk.layered.layering.layerConstraint': layer } } : {}),
      };
    }),
    edges: graph.edges.map((e): ElkExtendedEdge => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
      labels: [
        { text: texts.get(e.id)!, width: textWidth([texts.get(e.id)!]), height: LINE_HEIGHT },
      ],
    })),
  };
  const out = await engine.layout(input);

  const placed = new Map((out.children ?? []).map((c) => [c.id, c]));
  const routed = new Map(((out.edges ?? []) as ElkExtendedEdge[]).map((e) => [e.id, e]));
  const box = (s: { x?: number; y?: number; width?: number; height?: number } | undefined) => ({
    x: s?.x ?? 0,
    y: s?.y ?? 0,
    width: s?.width ?? 0,
    height: s?.height ?? 0,
  });
  return {
    width: out.width ?? 0,
    height: out.height ?? 0,
    nodes: graph.nodes.map((n) => ({ ...n, ...box(placed.get(n.id)) })),
    edges: graph.edges.map((e) => {
      const r = routed.get(e.id);
      const label: ElkLabel | undefined = r?.labels?.[0];
      return {
        ...e,
        points: (r?.sections ?? []).flatMap((s) => [
          s.startPoint,
          ...(s.bendPoints ?? []),
          s.endPoint,
        ]),
        label: { ...box(label), text: texts.get(e.id)! },
      };
    }),
  };
}

const intersect = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Pairs of laid-out boxes that intersect: node × node, label × node and
 * label × label. Empty for a readable layout.
 */
export function overlaps(layout: FactoryLayout): string[] {
  const boxes: [string, Box][] = [
    ...layout.nodes.map((n): [string, Box] => [`node ${n.id}`, n]),
    ...layout.edges.map((e): [string, Box] => [`label ${e.id}`, e.label]),
  ];
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (intersect(boxes[i]![1], boxes[j]![1])) found.push(`${boxes[i]![0]} × ${boxes[j]![0]}`);
  return found;
}
