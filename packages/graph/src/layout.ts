/**
 * ELK layered layout of a factory flowchart (docs/ARCHITECTURE.md §8).
 *
 * The ELK engine is injected: the web app runs it in its own worker, tests
 * run the bundled engine in Node. Node and label sizes are estimated from
 * their text, never measured, and ELK runs with a fixed seed, so identical
 * graphs always get identical coordinates.
 *
 * Ports and routing (A46): raw inputs (imports, missing inputs, resource
 * nodes and recipes with no inputs, such as Water) sit in a band along the
 * top, and their lines drop into the chart below. Every other node has one
 * port per item it takes or makes, on the slanted sides of its hexagon, with
 * the main product at the right vertex. ELK lays the chart out twice: once
 * free to order each node's ports, to learn the order with the fewest
 * crossings, then with the ports fixed at their places on the hexagon.
 */
import type { ElkExtendedEdge, ElkLabel, ElkNode, ElkPoint, ElkPort } from 'elkjs/lib/elk-api';
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

/** Where an item's line meets a node, relative to the node's box. */
export interface NodePort {
  item: string;
  dir: 'in' | 'out';
  x: number;
  y: number;
}

/**
 * A node as drawn: a hexagon with vertices left and right (A40). `slant` is
 * how far the slanted sides reach in from the box's left and right edges; the
 * text sits between them. `band`: a raw input, drawn in the band along the
 * top (A46).
 */
export type PlacedNode = FlowNode &
  Box & { text: NodeText; slant: number; band: boolean; ports: NodePort[] };

export interface PlacedEdge extends FlowEdge {
  /** The routed polyline, start to end (orthogonal segments). */
  points: ElkPoint[];
  /** `text` may hold line breaks (`\n`), one per wrapped line. */
  label: Box & { text: string };
}

/**
 * One output that feeds several consumers (A46): the lines share a trunk
 * labelled with the total, and each branch is labelled with its rate only.
 */
export interface Bundle {
  source: string;
  item: string;
  rate: number;
  /** Where the trunk splits into branches. */
  split: ElkPoint;
  label: Box & { text: string };
}

export interface FactoryLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  bundles: Bundle[];
}

export interface LayoutOptions {
  /**
   * Edge label text. `branch`: the edge is one branch of a bundle, whose
   * trunk names the item. Default: the rate, and the item name unless a
   * branch.
   */
  edgeLabel?: (e: FlowEdge, branch: boolean) => string;
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
/** Closest two ports on one side of a node, px; nodes grow to keep it. */
const PORT_GAP = 10;
/** Wrap widths, in characters, of node text and edge labels. */
const NODE_CHARS = 18;
const LABEL_CHARS = 10;
/** The drawing's margin, and the gaps around the raw-input band. */
const PAD = 8;
const BAND_GAP = 12;
/** Space between two parallel lines routed outside ELK. */
const LANE = 6;

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
  // Lines from the raw-input band enter through the top edge.
  'elk.portConstraints': 'FIXED_SIDE',
  'elk.padding': `[top=${PAD},left=${PAD},bottom=${PAD},right=${PAD}]`,
};

const LAYER: Partial<Record<FlowNodeKind, string>> = {
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

const defaultEdgeLabel = (e: FlowEdge, branch: boolean) =>
  branch ? rateText(e.rate) : `${rateText(e.rate)} ${e.itemName}`;

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
 * A raw input (A46): what the plan starts from, drawn in the band along the
 * top. Imports, missing inputs, resource nodes (miners and wells, even when
 * they take a fluid) and recipes that take nothing, such as Water.
 */
export function isRaw(n: FlowNode): boolean {
  return (
    n.kind === 'import' ||
    n.kind === 'missing' ||
    n.kind === 'resource' ||
    (n.kind === 'recipe' && n.inputs.length === 0)
  );
}

/**
 * The nodes drawn in the band (A46): the raw inputs that take nothing from
 * the chart, so every line between the band and the chart drops down. A
 * miner fed with Water from the band stays in it; one fed with an acid made
 * in the chart is drawn in the chart.
 */
export function bandNodes(graph: FactoryGraph): Set<string> {
  const band = new Set(graph.nodes.filter(isRaw).map((n) => n.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const e of graph.edges)
      if (band.has(e.target) && !band.has(e.source)) {
        band.delete(e.target);
        changed = true;
      }
  }
  return band;
}

/** How many outputs sit above and below the main product at most. */
const sideCount = (n: FlowNode) => {
  const others = n.outputs.length - (n.main !== undefined ? 1 : 0);
  return n.main !== undefined ? Math.ceil(others / 2) : 0;
};

/** How far in from the box's edge the slanted side is at height `y`. */
const reach = (h: number, slant: number, y: number) => (slant * Math.abs(y - h / 2)) / (h / 2);

/**
 * A node's ports in the order ELK keeps them (A46), clockwise: outputs down
 * the right side, then inputs up the left side. With a main product, unused
 * pad ports even out the outputs above and below it, so ELK's even spacing
 * puts it at the right vertex.
 */
function portOrder(
  id: string,
  ins: readonly string[],
  outs: readonly string[],
  main: string | undefined,
): { id: string; side: 'EAST' | 'WEST' }[] {
  const at = main === undefined ? -1 : outs.indexOf(main);
  const above = at < 0 ? 0 : at;
  const below = at < 0 ? 0 : outs.length - at - 1;
  const pad = (n: number, from: number) =>
    Array.from({ length: Math.max(0, n) }, (_, k) => ({
      id: `${id}#pad:${from + k}`,
      side: 'EAST' as const,
    }));
  return [
    ...pad(below - above, 0),
    ...outs.map((item) => ({ id: outPort(id, item), side: 'EAST' as const })),
    ...pad(above - below, Math.max(0, below - above)),
    ...[...ins].reverse().map((item) => ({ id: inPort(id, item), side: 'WEST' as const })),
  ];
}

/**
 * Puts the main product in the middle of ELK's order of a node's outputs:
 * as many above as ELK put there, but never more than one more on one side
 * than on the other.
 */
function centreMain(order: readonly string[], main: string | undefined): string[] {
  if (main === undefined || !order.includes(main)) return [...order];
  const others = order.filter((i) => i !== main);
  const want = order.indexOf(main);
  const above = Math.min(
    Math.ceil(others.length / 2),
    Math.max(Math.floor(others.length / 2), want),
  );
  return [...others.slice(0, above), main, ...others.slice(above)];
}

const inPort = (node: string, item: string) => `${node}#in:${item}`;
const outPort = (node: string, item: string) => `${node}#out:${item}`;
/** The point where a bundle's trunk splits (A46). */
const splitNode = (node: string, item: string) => `split:${node}:${item}`;
/** Side of a split point's node, px. */
const SPLIT = 2;
/** A line label's clearance from the node it sits beside (A43's gap floor is 6). */
const LABEL_CLEAR = 6;
/** One row of one-line labels, with the clearance between rows. */
const LABEL_ROW = FLOW_LINE_HEIGHT + LABEL_CLEAR;

type Sized = {
  node: FlowNode;
  text: NodeText;
  width: number;
  height: number;
  slant: number;
  /** Room left of the hexagon for the labels of lines dropping in (A46). */
  pad: number;
};
type Label = { text: string; width: number; height: number };
type Column = { left: number; right: number; ids: string[] };

/**
 * Lays the flowchart out left to right below a band of raw inputs: targets
 * and byproducts last.
 */
export async function layoutFactoryGraph(
  graph: FactoryGraph,
  engine: LayoutEngine,
  options: LayoutOptions = {},
): Promise<FactoryLayout> {
  const lines = options.nodeLines ?? nodeLines;
  const icon = options.iconSize ?? 0;
  const iconSpace = icon > 0 ? icon + ICON_GAP : 0;
  const edgeLabel = options.edgeLabel ?? defaultEdgeLabel;

  const raw = bandNodes(graph);
  // Lines in the chart (ELK routes them), lines dropping from the band into
  // the chart, and lines between two raw inputs, over the top of the band.
  // No line runs from the chart up into the band.
  const inner = graph.edges.filter((e) => !raw.has(e.source) && !raw.has(e.target));
  const drops = graph.edges.filter((e) => raw.has(e.source) && !raw.has(e.target));
  const over = graph.edges.filter((e) => raw.has(e.source) && raw.has(e.target));

  // An output feeding two or more lines in the chart is a bundle.
  const fanOut = new Map<string, FlowEdge[]>();
  for (const e of inner) {
    const key = `${e.source}\n${e.item}`;
    fanOut.set(key, [...(fanOut.get(key) ?? []), e]);
  }
  const bundled = new Map([...fanOut].filter(([, list]) => list.length > 1));
  const isBranch = (e: FlowEdge) => bundled.has(`${e.source}\n${e.item}`);
  const sizeOf = (text: string[]): Label => ({
    text: text.join('\n'),
    width: longest(text) * FLOW_CHAR_WIDTH,
    height: text.length * FLOW_LINE_HEIGHT,
  });
  // A line dropping from the band is a branch of the band node, which names
  // the item: its label is the rate, on one line beside the recipe.
  const labels = new Map<string, Label>(
    graph.edges.map((e) => {
      const text = edgeLabel(e, isBranch(e) || drops.includes(e));
      return [e.id, sizeOf(inner.includes(e) || over.includes(e) ? labelLines(text) : [text])];
    }),
  );
  // Each bundle's trunk runs from its output to a split point, a tiny node
  // of its own, where the branches leave.
  const trunks = [...bundled.values()].map((list) => {
    const first = list[0]!;
    const rate = list.reduce((s, e) => s + e.rate, 0);
    const split = splitNode(first.source, first.item);
    return { first, rate, split, label: sizeOf(labelLines(edgeLabel({ ...first, rate }, false))) };
  });
  const splitOf = (e: FlowEdge) => (isBranch(e) ? splitNode(e.source, e.item) : undefined);

  const dropsInto = (id: string) => drops.filter((e) => e.target === id);
  const sized = new Map<string, Sized>();
  for (const n of graph.nodes) {
    const text = nodeText(lines(n));
    const textWidth = Math.max(
      longest(text.title) * FLOW_TITLE_CHAR_WIDTH,
      longest(text.details) * FLOW_CHAR_WIDTH,
    );
    const into = dropsInto(n.id);
    // Ports at least PORT_GAP apart; a line dropping in has its label above
    // its port, so those ports are a label row apart.
    const ports = raw.has(n.id)
      ? 0
      : Math.max(
          (into.length ? LABEL_ROW : PORT_GAP) *
            (n.inputs.length + 1 + into.length - new Set(into.map((e) => e.item)).size),
          2 * PORT_GAP * (sideCount(n) + 1),
        );
    const height = Math.max(
      MIN_NODE_HEIGHT,
      ports,
      Math.max((text.title.length + text.details.length) * FLOW_LINE_HEIGHT, icon) +
        2 * (PADDING_Y + BORDER),
    );
    const slant = Math.round(height * SLANT);
    const width = Math.max(
      MIN_NODE_WIDTH,
      textWidth + iconSpace + 2 * (PADDING_X + BORDER) + 2 * slant,
    );
    const pad = into.length
      ? Math.max(...into.map((e) => labels.get(e.id)!.width)) + LABEL_CLEAR + 2
      : 0;
    sized.set(n.id, { node: n, text, width, height, slant, pad });
  }

  const chart = graph.nodes.filter((n) => !raw.has(n.id));
  const label = (l: Label): ElkLabel => ({ text: l.text, width: l.width, height: l.height });
  const elkEdges = [
    ...inner.map((e): ElkExtendedEdge => ({
      id: e.id,
      sources: [splitOf(e) ? `${splitOf(e)!}#out` : outPort(e.source, e.item)],
      targets: [inPort(e.target, e.item)],
      labels: [label(labels.get(e.id)!)],
    })),
    ...trunks.map((t): ElkExtendedEdge => ({
      id: t.split,
      sources: [outPort(t.first.source, t.first.item)],
      targets: [`${t.split}#in`],
      labels: [label(t.label)],
    })),
    // Lines dropping from the band, so ELK orders the chart with them in
    // mind; their routes are drawn by hand (A46).
    ...drops.map((e): ElkExtendedEdge => ({
      id: `top:${e.id}`,
      sources: [`top#${e.id}`],
      targets: [inPort(e.target, e.item)],
    })),
  ];

  type Order = { id: string; side: 'EAST' | 'WEST' }[];
  const elkGraph = (orders: Map<string, Order> | undefined, corridor: number): ElkNode => {
    // Room beside each column for the lines to and from the band (A46).
    const edgeNode = Math.max(6, corridor ? 7 + (corridor - 1) * LANE : 0);
    return {
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'fixed' },
      children: [
        {
          id: 'chart',
          layoutOptions: {
            ...ELK_OPTIONS,
            'elk.layered.spacing.edgeNodeBetweenLayers': String(edgeNode),
            'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.max(12, edgeNode + 3)),
            // The first column's lanes stay inside the drawing.
            'elk.padding': `[top=${PAD},left=${Math.max(PAD, edgeNode + 2)},bottom=${PAD},right=${Math.max(PAD, edgeNode + 2)}]`,
          },
          edges: elkEdges,
          ports: drops.map((e) => ({
            id: `top#${e.id}`,
            width: 0,
            height: 0,
            layoutOptions: { 'elk.port.side': 'NORTH' },
          })),
          children: [
            ...chart.map((n): ElkNode => {
              const s = sized.get(n.id)!;
              const layer = LAYER[n.kind];
              const order = orders?.get(n.id);
              const port = (id: string, side: 'EAST' | 'WEST', k?: number): ElkPort => ({
                id,
                width: 0,
                height: 0,
                layoutOptions: {
                  'elk.port.side': side,
                  ...(k !== undefined ? { 'elk.port.index': String(k) } : {}),
                },
              });
              return {
                id: n.id,
                width: s.pad + s.width,
                height: s.height,
                layoutOptions: {
                  'elk.portConstraints': order ? 'FIXED_ORDER' : 'FIXED_SIDE',
                  ...(layer ? { 'elk.layered.layering.layerConstraint': layer } : {}),
                },
                ports: order
                  ? order.map((p, k) => port(p.id, p.side, k))
                  : [
                      ...n.inputs.map((f) => port(inPort(n.id, f.item), 'WEST')),
                      ...n.outputs.map((f) => port(outPort(n.id, f.item), 'EAST')),
                    ],
              };
            }),
            ...trunks.map((t): ElkNode => ({
              id: t.split,
              width: SPLIT,
              height: SPLIT,
              layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
              ports: (['in', 'out'] as const).map((dir) => ({
                id: `${t.split}#${dir}`,
                width: 0,
                height: 0,
                layoutOptions: { 'elk.port.side': dir === 'in' ? 'WEST' : 'EAST' },
              })),
            })),
          ],
        },
      ],
    };
  };

  // Pass 1: ELK orders each node's ports. Pass 2: the ports keep that
  // order, with the main product moved to the middle of the outputs and the
  // lines dropping from the band at the top of the inputs.
  let out: ElkNode | undefined;
  if (chart.length) {
    const first = (await engine.layout(elkGraph(undefined, 0))).children?.[0];
    const firstPorts = new Map((first?.children ?? []).map((c) => [c.id, c.ports ?? []]));
    const orders = new Map<string, Order>();
    for (const n of chart) {
      const ys = new Map((firstPorts.get(n.id) ?? []).map((p) => [p.id, p.y ?? 0]));
      const order = (items: readonly { item: string }[], id: (item: string) => string) =>
        items
          .map((f, k) => ({ item: f.item, y: ys.get(id(f.item)) ?? 0, k }))
          .sort((a, b) => a.y - b.y || a.k - b.k)
          .map((p) => p.item);
      const fromBand = new Set(dropsInto(n.id).map((e) => e.item));
      const ins = order(n.inputs, (i) => inPort(n.id, i));
      const outs = centreMain(
        order(n.outputs, (i) => outPort(n.id, i)),
        n.main,
      );
      orders.set(
        n.id,
        portOrder(
          n.id,
          [...ins.filter((i) => fromBand.has(i)), ...ins.filter((i) => !fromBand.has(i))],
          outs,
          n.main,
        ),
      );
    }
    const corridor = Math.max(
      0,
      ...columns(first?.children ?? []).map(
        (c) => drops.filter((e) => c.ids.includes(e.target)).length,
      ),
    );
    out = (await engine.layout(elkGraph(orders, corridor))).children?.[0];
  }
  const placed = new Map((out?.children ?? []).map((c) => [c.id, c]));
  const routed = new Map(((out?.edges ?? []) as ElkExtendedEdge[]).map((e) => [e.id, e]));

  // Each port where ELK put it on the box's edge, moved in to the slanted
  // side; the hexagon sits right of its label room.
  const hex = new Map<string, Box>();
  const nodePorts = new Map<string, NodePort[]>();
  for (const n of chart) {
    const s = sized.get(n.id)!;
    const c = placed.get(n.id);
    hex.set(n.id, { x: (c?.x ?? 0) + s.pad, y: c?.y ?? 0, width: s.width, height: s.height });
    const ports: NodePort[] = [];
    for (const p of c?.ports ?? []) {
      const [, kind = ''] = p.id.slice(n.id.length).split(/[#:]/);
      if (kind !== 'in' && kind !== 'out') continue;
      const item = p.id.slice(n.id.length + kind.length + 2);
      const y = p.y ?? 0;
      const x = kind === 'in' ? reach(s.height, s.slant, y) : s.width - reach(s.height, s.slant, y);
      ports.push({ item, dir: kind, x, y });
    }
    nodePorts.set(n.id, ports);
  }
  /** A port's point on the slanted side, in chart coordinates. */
  const portAt = (node: string, dir: 'in' | 'out', item: string): ElkPoint | undefined => {
    const h = hex.get(node);
    const p = nodePorts.get(node)?.find((q) => q.dir === dir && q.item === item);
    return h && p ? { x: h.x + p.x, y: h.y + p.y } : undefined;
  };

  // Lines from the band run down a lane just left of the column of the node
  // they feed, the topmost port's lane nearest the column.
  const laneX = new Map<string, number>();
  for (const c of columns(out?.children ?? []))
    drops
      .filter((e) => c.ids.includes(e.target))
      .map((e) => ({ e, y: portAt(e.target, 'in', e.item)?.y ?? 0 }))
      .sort((a, b) => a.y - b.y || (a.e.id < b.e.id ? -1 : 1))
      .forEach(({ e }, k) => laneX.set(e.id, c.left - 3 - k * LANE));

  const band = placeBand(graph, raw, sized, laneX, (id) => labels.get(id)!);
  const shift = band.chartTop;
  const at = (p: ElkPoint): ElkPoint => ({ x: p.x, y: p.y + shift });
  const route = (r: ElkExtendedEdge | undefined) =>
    orthogonal(
      (r?.sections ?? []).flatMap((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]),
    ).map(at);
  const box = (s: { x?: number; y?: number; width?: number; height?: number } | undefined) => ({
    x: s?.x ?? 0,
    y: (s?.y ?? 0) + shift,
    width: s?.width ?? 0,
    height: s?.height ?? 0,
  });

  const nodes = graph.nodes.map((n): PlacedNode => {
    const s = sized.get(n.id)!;
    const base = { ...n, text: s.text, slant: s.slant };
    const b = band.nodes.get(n.id);
    if (b) return { ...base, ...b, band: true };
    return { ...base, ...box(hex.get(n.id)), band: false, ports: nodePorts.get(n.id)! };
  });
  const end = (node: string, dir: 'in' | 'out', item: string) => {
    const p = portAt(node, dir, item);
    return p ? [at(p)] : [];
  };
  // Labels of lines dropping into one port stack upwards from it.
  const stacked = new Map<string, number>();
  const edges = graph.edges.map((e): PlacedEdge => {
    const l = labels.get(e.id)!;
    const own = band.edges.get(e.id);
    if (own) return { ...e, points: own.points, label: { ...own.label, text: l.text } };
    if (drops.includes(e)) {
      const p = end(e.target, 'in', e.item);
      const x = laneX.get(e.id)!;
      const y = p[0]?.y ?? shift;
      const key = `${e.target}\n${e.item}`;
      const row = stacked.get(key) ?? 0;
      stacked.set(key, row + 1);
      const h = hex.get(e.target)!;
      return {
        ...e,
        points: join(
          band.drops.get(e.id) ?? [],
          [
            { x, y: shift },
            { x, y },
          ],
          p,
        ),
        label: {
          x: h.x - LABEL_CLEAR - l.width,
          y: y - 2 - l.height - row * LABEL_ROW,
          width: l.width,
          height: l.height,
          text: l.text,
        },
      };
    }
    const split = splitOf(e);
    const points = [...(split ? route(routed.get(split)) : []), ...route(routed.get(e.id))];
    return {
      ...e,
      points: join(end(e.source, 'out', e.item), points, end(e.target, 'in', e.item)),
      label: { ...box(routed.get(e.id)?.labels?.[0]), text: l.text },
    };
  });
  const bundles = trunks.map((t): Bundle => {
    const s = placed.get(t.split);
    return {
      source: t.first.source,
      item: t.first.item,
      rate: t.rate,
      split: { x: (s?.x ?? 0) + SPLIT / 2, y: (s?.y ?? 0) + SPLIT / 2 + shift },
      label: { ...box(routed.get(t.split)?.labels?.[0]), text: t.label.text },
    };
  });
  return {
    width: Math.max(out?.width ?? 0, band.width),
    height: shift + (out?.height ?? 0),
    nodes,
    edges,
    bundles,
  };
}

/** ELK's layers as columns: boxes whose x ranges overlap, left to right. */
function columns(children: readonly ElkNode[]): Column[] {
  const boxes = [...children].sort((a, b) => (a.x ?? 0) - (b.x ?? 0) || (a.id < b.id ? -1 : 1));
  const out: Column[] = [];
  for (const c of boxes) {
    const left = c.x ?? 0;
    const right = left + (c.width ?? 0);
    const last = out.at(-1);
    if (last && left < last.right) {
      last.right = Math.max(last.right, right);
      last.ids.push(c.id);
    } else out.push({ left, right, ids: [c.id] });
  }
  return out;
}

const EPS = 1e-6;

/**
 * ELK's route, or a plain one where ELK's has a slanted segment. ELK
 * sometimes leaves stale bend points on an edge it straightened (its ends
 * level with each other); that edge is drawn straight.
 */
export function orthogonal(points: ElkPoint[]): ElkPoint[] {
  const slanted = points
    .slice(1)
    .some((p, k) => Math.abs(p.x - points[k]!.x) > EPS && Math.abs(p.y - points[k]!.y) > EPS);
  if (!slanted || points.length < 2) return points;
  const a = points[0]!;
  const b = points.at(-1)!;
  if (Math.abs(a.y - b.y) <= EPS) return [a, b];
  const mid = (a.x + b.x) / 2;
  return [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b];
}

/** `a`, then `b`, then `c`, without repeating a point where they meet. */
function join(...parts: ElkPoint[][]): ElkPoint[] {
  const out: ElkPoint[] = [];
  for (const p of parts.flat()) {
    const last = out.at(-1);
    if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.y - p.y) > 1e-6) out.push(p);
  }
  // Drop points in the middle of a straight run.
  return out.filter((p, k) => {
    const a = out[k - 1];
    const b = out[k + 1];
    if (!a || !b) return true;
    const flat = Math.abs(a.y - p.y) < 1e-6 && Math.abs(b.y - p.y) < 1e-6;
    const upright = Math.abs(a.x - p.x) < 1e-6 && Math.abs(b.x - p.x) < 1e-6;
    return !flat && !upright;
  });
}

interface Band {
  /** Where the chart's top edge lands. */
  chartTop: number;
  width: number;
  nodes: Map<string, Box & { ports: NodePort[] }>;
  /** Per edge from a raw input: its line from the node down to the chart's top edge. */
  drops: Map<string, ElkPoint[]>;
  /** Lines between two raw inputs, over the top of the band. */
  edges: Map<string, { points: ElkPoint[]; label: Box }>;
}

/**
 * The raw-input band (A46): one row along the top, each raw input as close
 * above the lanes its lines drop down as the row allows. Below each raw
 * input, a bus runs sideways to those lanes; buses that overlap get lanes of
 * their own. Lines between two raw inputs run over the top of the band, each
 * in a lane of its own with its label above it.
 */
function placeBand(
  graph: FactoryGraph,
  raw: ReadonlySet<string>,
  sized: ReadonlyMap<string, Sized>,
  laneX: ReadonlyMap<string, number>,
  labelOf: (edge: string) => Label,
): Band {
  const empty: Band = {
    chartTop: 0,
    width: 0,
    nodes: new Map(),
    drops: new Map(),
    edges: new Map(),
  };
  const members = graph.nodes.filter((n) => raw.has(n.id));
  if (!members.length) return empty;

  // Each raw input's ports: lines to other raw inputs on its top, one per
  // item into the chart on its bottom.
  const over = graph.edges.filter((e) => raw.has(e.source) && raw.has(e.target));
  const below = (id: string) => {
    const list: { item: string; dir: 'out'; ports: { edge: string; x: number }[] }[] = [];
    for (const e of graph.edges) {
      if (e.source !== id || raw.has(e.target)) continue;
      const x = laneX.get(e.id) ?? 0;
      const has = list.find((p) => p.item === e.item);
      if (has) has.ports.push({ edge: e.id, x });
      else list.push({ item: e.item, dir: 'out', ports: [{ edge: e.id, x }] });
    }
    return list;
  };
  const above = (id: string) => {
    const list: { item: string; dir: 'in' | 'out'; edge: string }[] = [];
    for (const e of over) {
      if (e.target === id) list.push({ item: e.item, dir: 'in', edge: e.id });
      if (e.source === id) list.push({ item: e.item, dir: 'out', edge: e.id });
    }
    return list;
  };

  // Order the row by where each raw input's lines enter the chart; one with
  // none goes next to the raw inputs it feeds or is fed by.
  const want = new Map<string, number>();
  for (const n of members) {
    const xs = below(n.id).flatMap((p) => p.ports.map((q) => q.x));
    if (xs.length) want.set(n.id, xs.reduce((s, x) => s + x, 0) / xs.length);
  }
  for (const n of members)
    if (!want.has(n.id)) {
      const near = over
        .flatMap((e) => (e.source === n.id ? [e.target] : e.target === n.id ? [e.source] : []))
        .map((id) => want.get(id))
        .filter((x): x is number => x !== undefined);
      want.set(n.id, near.length ? near.reduce((s, x) => s + x, 0) / near.length : 0);
    }
  const row = [...members].sort(
    (a, b) => want.get(a.id)! - want.get(b.id)! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // Lanes over the band, outermost first, each with its label above its line.
  const lanes = over.map((e) => ({ e, label: labelOf(e.id) }));
  const order = new Map(row.map((n, k) => [n.id, k]));
  const span = (e: FlowEdge) => Math.abs(order.get(e.source)! - order.get(e.target)!);
  lanes.sort((a, b) => span(b.e) - span(a.e) || (a.e.id < b.e.id ? -1 : 1));
  let y = PAD;
  const laneY = new Map<string, { line: number; top: number }>();
  for (const l of lanes) {
    laneY.set(l.e.id, { top: y, line: y + l.label.height + 2 });
    y += l.label.height + 2 + LANE;
  }
  const rowTop = lanes.length ? y + LANE : PAD;
  const rowHeight = Math.max(...row.map((n) => sized.get(n.id)!.height));

  // Left to right, each as near its wish as the one before it allows.
  const nodes = new Map<string, Box & { ports: NodePort[] }>();
  let right = PAD - BAND_GAP;
  for (const n of row) {
    const s = sized.get(n.id)!;
    const x = Math.max(right + BAND_GAP, want.get(n.id)! - s.width / 2);
    right = x + s.width;
    const top = above(n.id);
    const bottom = below(n.id);
    const spread = (count: number, k: number) =>
      s.slant + ((s.width - 2 * s.slant) * (k + 1)) / (count + 1);
    nodes.set(n.id, {
      x,
      y: rowTop + (rowHeight - s.height) / 2,
      width: s.width,
      height: s.height,
      ports: [
        ...top.map((p, k): NodePort => ({
          item: p.item,
          dir: p.dir,
          x: spread(top.length, k),
          y: 0,
        })),
        ...bottom.map((p, k): NodePort => ({
          item: p.item,
          dir: p.dir,
          x: spread(bottom.length, k),
          y: s.height,
        })),
      ],
    });
  }

  // Below the band: each bus that has to run sideways takes the first lane
  // where it doesn't overlap another.
  const rowBottom = rowTop + rowHeight;
  const buses = row.flatMap((n) => {
    const b = nodes.get(n.id)!;
    const bottom = b.ports.filter((q) => q.y > 0);
    return below(n.id).map((p, k) => {
      const from = b.x + bottom[k]!.x;
      const xs = [from, ...p.ports.map((q) => q.x)];
      return { ...p, node: b, from, left: Math.min(...xs), right: Math.max(...xs) };
    });
  });
  const ends: number[] = [];
  const laneOf = new Map<(typeof buses)[number], number>();
  for (const bus of [...buses].sort((a, b) => a.left - b.left || a.from - b.from)) {
    if (bus.right - bus.left <= 0.5) continue;
    let k = ends.findIndex((r) => r + BAND_GAP <= bus.left);
    if (k < 0) k = ends.push(bus.right) - 1;
    else ends[k] = bus.right;
    laneOf.set(bus, rowBottom + BAND_GAP + k * LANE);
  }
  const chartTop = rowBottom + BAND_GAP + Math.max(0, ends.length - 1) * LANE + BAND_GAP;

  const drops = new Map<string, ElkPoint[]>();
  for (const bus of buses) {
    const start = { x: bus.from, y: bus.node.y + bus.node.height };
    const lane = laneOf.get(bus);
    for (const p of bus.ports)
      drops.set(
        p.edge,
        lane === undefined
          ? [start, { x: p.x, y: chartTop }]
          : [start, { x: bus.from, y: lane }, { x: p.x, y: lane }, { x: p.x, y: chartTop }],
      );
  }

  const edges = new Map<string, { points: ElkPoint[]; label: Box }>();
  for (const l of lanes) {
    const { e } = l;
    const s = nodes.get(e.source)!;
    const t = nodes.get(e.target)!;
    const from = s.x + s.ports.find((p) => p.y === 0 && p.dir === 'out' && p.item === e.item)!.x;
    const to = t.x + t.ports.find((p) => p.y === 0 && p.dir === 'in' && p.item === e.item)!.x;
    const lane = laneY.get(e.id)!;
    edges.set(e.id, {
      points: [
        { x: from, y: s.y },
        { x: from, y: lane.line },
        { x: to, y: lane.line },
        { x: to, y: t.y },
      ],
      label: {
        x: (from + to) / 2 - l.label.width / 2,
        y: lane.top,
        width: l.label.width,
        height: l.label.height,
      },
    });
  }
  return {
    chartTop,
    width: right + PAD,
    nodes,
    drops,
    edges,
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
    ...layout.bundles.map((b): [string, Box] => [`trunk ${b.source}:${b.item}`, b.label]),
  ];
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (intersect(boxes[i]![1], boxes[j]![1])) found.push(`${boxes[i]![0]} × ${boxes[j]![0]}`);
  return found;
}
