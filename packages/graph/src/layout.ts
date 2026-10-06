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

/** A node's text as drawn: its title and detail lines, already wrapped. */
export interface NodeText {
  title: string[];
  details: string[];
}

export type PlacedNode = FlowNode & Box & { text: NodeText };

export interface PlacedEdge extends FlowEdge {
  /** The routed polyline, start to end (orthogonal segments). */
  points: ElkPoint[];
  /** `text` may hold line breaks (`\n`), one per wrapped line. */
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
  /**
   * Side of a square icon drawn left of each node's text, in px. Default 0
   * (no icon). Nodes grow by the icon and its gap, and are at least as tall.
   */
  iconSize?: number;
}

/** Space between a node's icon and its text. */
export const ICON_GAP = 6;

/** Estimated text metrics of the world graph's 12px UI font. */
export const CHAR_WIDTH = 7;
export const LINE_HEIGHT = 16;

/**
 * Estimated text metrics of the factory flowchart's 14px font, wide enough
 * for DejaVu Sans (among the widest system UI fonts); titles are semibold.
 * The flowchart is zoomed to fit, so what makes its text readable is how
 * much of the drawing is text: nodes and labels wrap into narrow columns
 * and the spacing around them is tight.
 */
const FLOW_CHAR_WIDTH = 8.5;
const FLOW_TITLE_CHAR_WIDTH = 9.5;
const FLOW_LINE_HEIGHT = 17;
const PADDING_X = 6;
const PADDING_Y = 4;
/** The node's 1px border, inside its box. */
const BORDER = 1;
const MIN_NODE_WIDTH = 80;
/** Wrap widths, in characters, of node text and edge labels. */
const NODE_CHARS = 14;
const LABEL_CHARS = 10;

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.randomSeed': '1',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.spacing.nodeNode': '12',
  'elk.spacing.edgeNode': '8',
  'elk.spacing.edgeEdge': '4',
  'elk.spacing.edgeLabel': '2',
  'elk.layered.spacing.nodeNodeBetweenLayers': '12',
  'elk.layered.spacing.edgeNodeBetweenLayers': '6',
  // Network-simplex placement takes minutes on a 150-node plan; Brandes–Köpf
  // and a lighter crossing sweep keep it well under the 2 s budget (PLAN M7).
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.thoroughness': '3',
  'elk.padding': '[top=8,left=8,bottom=8,right=8]',
};

const LAYER: Partial<Record<FlowNodeKind, string>> = {
  import: 'FIRST',
  missing: 'FIRST',
  target: 'LAST',
  byproduct: 'LAST',
};

/** Compact rate: up to 3 decimals, 3 significant digits below 0.001, commas between thousands. */
export function rateText(n: number): string {
  if (n !== 0 && Math.abs(n) < 0.001) return n.toPrecision(3);
  const [whole = '', frac] = String(Math.round(n * 1000) / 1000).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
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
    case 'missing':
      return [`Missing: ${n.label}`, `${rateText(n.rate ?? 0)}/min`];
    case 'target':
      return [`Target: ${n.label}`, `${rateText(n.rate ?? 0)}/min`];
    case 'byproduct':
      return [`Byproduct: ${n.label}`, `${rateText(n.rate ?? 0)}/min`];
  }
}

const defaultEdgeLabel = (e: FlowEdge) => `${rateText(e.rate)} ${e.itemName}`;

/**
 * Greedy word wrap to lines of at most `max` characters; a longer word keeps
 * a line of its own.
 */
export function wrapText(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...out, line];
}

/** A node's lines wrapped: the first line is the title, the rest details. */
export function nodeText(lines: readonly string[]): NodeText {
  const [title = '', ...rest] = lines;
  return {
    title: wrapText(title, NODE_CHARS),
    details: rest.flatMap((l) => wrapText(l, NODE_CHARS)),
  };
}

/** An edge label on one line when it fits, else the rate above the wrapped item name. */
function labelLines(text: string): string[] {
  if (text.length <= LABEL_CHARS) return [text];
  const [rate = '', ...name] = text.split(' ');
  return [rate, ...wrapText(name.join(' '), LABEL_CHARS)];
}

const longest = (lines: readonly string[]) => Math.max(0, ...lines.map((l) => l.length));

/** Lays the flowchart out left to right: imports first, targets and byproducts last. */
export async function layoutFactoryGraph(
  graph: FactoryGraph,
  engine: LayoutEngine,
  options: LayoutOptions = {},
): Promise<FactoryLayout> {
  const lines = options.nodeLines ?? nodeLines;
  const icon = options.iconSize ?? 0;
  const iconSpace = icon > 0 ? icon + ICON_GAP : 0;
  const edgeLabel = options.edgeLabel ?? defaultEdgeLabel;
  const nodeTexts = new Map(graph.nodes.map((n) => [n.id, nodeText(lines(n))]));
  const labels = new Map(graph.edges.map((e) => [e.id, labelLines(edgeLabel(e))]));
  const input: ElkNode = {
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children: graph.nodes.map((n) => {
      const { title, details } = nodeTexts.get(n.id)!;
      const layer = LAYER[n.kind];
      const textWidth = Math.max(
        longest(title) * FLOW_TITLE_CHAR_WIDTH,
        longest(details) * FLOW_CHAR_WIDTH,
      );
      return {
        id: n.id,
        width: Math.max(MIN_NODE_WIDTH, textWidth + iconSpace + 2 * (PADDING_X + BORDER)),
        height:
          Math.max((title.length + details.length) * FLOW_LINE_HEIGHT, icon) +
          2 * (PADDING_Y + BORDER),
        ...(layer ? { layoutOptions: { 'elk.layered.layering.layerConstraint': layer } } : {}),
      };
    }),
    edges: graph.edges.map((e): ElkExtendedEdge => {
      const l = labels.get(e.id)!;
      return {
        id: e.id,
        sources: [e.source],
        targets: [e.target],
        labels: [
          {
            text: l.join('\n'),
            width: longest(l) * FLOW_CHAR_WIDTH,
            height: l.length * FLOW_LINE_HEIGHT,
          },
        ],
      };
    }),
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
    nodes: graph.nodes.map((n) => ({ ...n, ...box(placed.get(n.id)), text: nodeTexts.get(n.id)! })),
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
        label: { ...box(label), text: labels.get(e.id)!.join('\n') },
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
