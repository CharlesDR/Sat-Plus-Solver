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

/**
 * A node as drawn: a hexagon with vertices left and right (A40). `slant` is
 * how far the slanted sides reach in from the box's left and right edges; the
 * text sits between them.
 */
export type PlacedNode = FlowNode & Box & { text: NodeText; slant: number };

/**
 * Where an edge meets a node's hexagon (A40): `in` is the left vertex, `out`
 * the right one (the main product, or an import's item), `by1` the lower
 * right vertex and `by2` the upper right one (byproducts, alternately).
 */
export type Port = 'in' | 'out' | 'by1' | 'by2';

export interface PlacedEdge extends FlowEdge {
  sourcePort: Port;
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
/** Slanted sides at 60° to the flat top and bottom: they reach in tan 30° × height / 2. */
const SLANT = Math.tan(Math.PI / 6) / 2;
/** Shortest hexagon, so short nodes keep clear vertices for their edges. */
const MIN_NODE_HEIGHT = 44;
/** Wrap widths, in characters, of node text and edge labels. */
const NODE_CHARS = 18;
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

/**
 * A rate or machine count as the app writes it (A41): 1 to 4 decimals,
 * rounded up away from zero to the next 0.0001, commas between thousands.
 * The same rule as the solver's `formatRate`, which this package may not
 * import; a tooling test keeps the two equal.
 */
export function rateText(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const size = Math.abs(n);
  const noise = Math.min(1e-9 * Math.max(1, size) * 1e4, 0.01);
  const steps = Math.ceil(size * 1e4 - noise);
  if (steps <= 0) return '0.0';
  const whole = String(Math.floor(steps / 1e4)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(steps % 1e4)
    .padStart(4, '0')
    .replace(/0+$/, '');
  return `${n < 0 ? '-' : ''}${whole}.${frac || '0'}`;
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

/**
 * Which vertex of its source an edge leaves from (A40): the main product from
 * the right vertex, a recipe's other outputs alternately from the lower and
 * upper right vertices, in item order.
 */
export function sourcePorts(graph: FactoryGraph): Map<string, Port> {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Port>();
  for (const e of graph.edges) {
    const n = nodes.get(e.source);
    if (!n || n.main === undefined || e.item === n.main) {
      out.set(e.id, 'out');
      continue;
    }
    const by = n.outputs.filter((f) => f.item !== n.main).findIndex((f) => f.item === e.item);
    out.set(e.id, by % 2 === 0 ? 'by1' : 'by2');
  }
  return out;
}

/** Port positions on a w × h node box, and the side ELK routes them from. */
function portSpots(w: number, h: number, slant: number) {
  return {
    in: { x: 0, y: h / 2, side: 'WEST' },
    out: { x: w, y: h / 2, side: 'EAST' },
    by1: { x: w - slant, y: h, side: 'SOUTH' },
    by2: { x: w - slant, y: 0, side: 'NORTH' },
  } as const;
}

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
  const ports = sourcePorts(graph);
  const slants = new Map<string, number>();
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
      const height = Math.max(
        MIN_NODE_HEIGHT,
        Math.max((title.length + details.length) * FLOW_LINE_HEIGHT, icon) +
          2 * (PADDING_Y + BORDER),
      );
      const slant = Math.round(height * SLANT);
      slants.set(n.id, slant);
      const width = Math.max(
        MIN_NODE_WIDTH,
        textWidth + iconSpace + 2 * (PADDING_X + BORDER) + 2 * slant,
      );
      const spots = portSpots(width, height, slant);
      return {
        id: n.id,
        width,
        height,
        layoutOptions: {
          'elk.portConstraints': 'FIXED_POS',
          ...(layer ? { 'elk.layered.layering.layerConstraint': layer } : {}),
        },
        ports: (Object.keys(spots) as Port[]).map((p) => ({
          id: `${n.id}#${p}`,
          x: spots[p].x,
          y: spots[p].y,
          width: 0,
          height: 0,
          layoutOptions: { 'elk.port.side': spots[p].side },
        })),
      };
    }),
    edges: graph.edges.map((e): ElkExtendedEdge => {
      const l = labels.get(e.id)!;
      return {
        id: e.id,
        sources: [`${e.source}#${ports.get(e.id)!}`],
        targets: [`${e.target}#in`],
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
    nodes: graph.nodes.map((n) => ({
      ...n,
      ...box(placed.get(n.id)),
      text: nodeTexts.get(n.id)!,
      slant: slants.get(n.id)!,
    })),
    edges: graph.edges.map((e) => {
      const r = routed.get(e.id);
      const label: ElkLabel | undefined = r?.labels?.[0];
      return {
        ...e,
        sourcePort: ports.get(e.id)!,
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
