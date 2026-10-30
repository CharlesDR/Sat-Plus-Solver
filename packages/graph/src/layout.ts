/**
 * ELK layered layout of a factory flowchart (docs/ARCHITECTURE.md §8).
 *
 * The ELK engine is injected: the web app runs it in its own worker, tests
 * run the bundled engine in Node. Node and label sizes are estimated from
 * their text, never measured, and ELK runs with a fixed seed, so identical
 * graphs always get identical coordinates.
 *
 * Ports and labels (A93): every node is a box with one port per item it
 * takes on its left edge and one per item it makes on its right edge, the
 * main product in the middle. Each line's label (icon and rate) sits on its
 * route, centred, where ELK makes room for it. ELK lays the chart out
 * twice: once free to order each node's ports, to learn the order with the
 * fewest crossings, then with the ports fixed in that order.
 */
import type { ElkExtendedEdge, ElkNode, ElkPoint, ElkPort } from 'elkjs/lib/elk-api';
import type { FactoryGraph, FlowEdge, FlowNode, FlowNodeKind, GraphArea } from './factory';
import { layoutScore } from './score';

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
 * A node as drawn: a solid box (A93), its inputs on the left edge and its
 * outputs on the right. `stages`: a raw input feeding recipes at that many
 * stages of the plan (2 or more), drawn marked (A47).
 */
export type PlacedNode = FlowNode &
  Box & {
    text: NodeText;
    ports: NodePort[];
    stages?: number;
    /** How far the hexagon's left and right vertices stand out from its flat top and bottom (DF-2). */
    slant: number;
  };

export interface PlacedEdge extends FlowEdge {
  /** The routed polyline, start to end (orthogonal segments). */
  points: ElkPoint[];
  /** Centred on the route, where ELK placed it among the boxes (A93). */
  label: Box & { text: string };
}

/** An area's frame (A63): its box, with the title bar along its top. */
export type PlacedArea = GraphArea & Box;

export interface FactoryLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  /** Frames of the open areas of a grouped plan (A63). */
  areas?: PlacedArea[];
}

export interface LayoutOptions {
  /** Node text lines, used to size it. Default: `nodeLines` with `rate`. */
  nodeLines?: (n: FlowNode) => string[];
  /** How rates and counts are written in nodes and labels. Default: `rateText` (A41). */
  rate?: (n: number) => string;
  /**
   * Side of a square icon drawn left of each node's text, in px. Default 0
   * (no icon). Nodes grow by the icon and its gap, and are at least as tall.
   */
  iconSize?: number;
  /**
   * Side of the item icon drawn before the rate in every line label (A48),
   * in px. Default 0 (no icon).
   */
  labelIconSize?: number;
}

/** Space between a node's icon and its text. */
export const ICON_GAP = 6;
/** Space between a label's item icon and its rate. */
export const LABEL_ICON_GAP = 3;
/** Padding either side of a line label's icon and rate, inside its box (A93). */
export const LABEL_PAD = 3;

/** Estimated text metrics of the world graph's 12px UI font. */
export const CHAR_WIDTH = 7;
export const LINE_HEIGHT = 16;

/**
 * Estimated text metrics of the factory flowchart's 14px font, wide enough
 * for DejaVu Sans (among the widest system UI fonts); titles are semibold.
 * The flowchart is zoomed to fit, so what makes its text readable is how
 * much of the drawing is text: nodes wrap into narrow columns and the
 * spacing around them is tight.
 */
const FLOW_CHAR_WIDTH = 8.5;
const FLOW_TITLE_CHAR_WIDTH = 9.5;
const FLOW_LINE_HEIGHT = 17;
const PADDING_X = 6;
const PADDING_Y = 4;
/** The node's 1px border, inside its box. */
const BORDER = 1;
const MIN_NODE_WIDTH = 80;
/** A hexagon's slant per px of height: sides at 60° to the flat top and bottom (A40, DF-2). */
const SLANT = Math.tan(Math.PI / 6) / 2;
/** Shortest box: room for its icon and padding. */
const MIN_NODE_HEIGHT = 40;
/** Space between two ports on one side of a box, enough for the thickest lines. */
const PORT_ROW = 12;
/** Wrap width, in characters, of node text. */
const NODE_CHARS = 18;
/** The drawing's margin. */
const PAD = 8;
/** A label's clearance from boxes and other labels (A43's gap floor is 6). */
const LABEL_CLEAR = 6;

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.randomSeed': '1',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '12',
  'elk.spacing.edgeNode': '8',
  'elk.spacing.edgeEdge': '4',
  'elk.layered.spacing.nodeNodeBetweenLayers': '12',
  'elk.layered.spacing.edgeNodeBetweenLayers': '6',
  // Lanes between layers as close as lanes beside a box (A55): shorter lines
  // and a smaller chart on every scored plan, with no new crossing or bend.
  'elk.layered.spacing.edgeEdgeBetweenLayers': '4',
  // Network-simplex placement takes minutes on a 150-node plan; Brandes–Köpf
  // and a lighter crossing sweep keep it well under the 2 s budget (PLAN M7).
  // Without labels in the chart (A48), a sweep of 5 costs little more than 3
  // and cuts crossings on every scored plan.
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.thoroughness': '5',
  'elk.portConstraints': 'FIXED_SIDE',
  'elk.padding': `[top=${PAD},left=${PAD},bottom=${PAD},right=${PAD}]`,
};

/** Below this many nodes a plan counts as small for layout tuning (A55). */
export const SMALL_PLAN = 60;

/**
 * ELK options for a plan of `nodes` nodes (A55). Small plans get a
 * post-compaction pass that pulls layers together along their edges; on a
 * large plan the same pass adds crossings, so it gets a deeper crossing
 * sweep instead, which still fits the 2 s budget.
 */
export const elkOptions = (nodes: number): Record<string, string> =>
  nodes < SMALL_PLAN
    ? { ...ELK_OPTIONS, 'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH' }
    : { ...ELK_OPTIONS, 'elk.layered.thoroughness': '6' };

/** Height of an area's title bar (A63), inside its frame. */
export const AREA_TITLE = 28;
/** Each line's label sits on it, centred, and ELK makes room for it (A93). */
const LABEL_OPTIONS = { 'elk.edgeLabels.placement': 'CENTER', 'elk.edgeLabels.inline': 'true' };
/** Space between area frames, and around the lines between them. */
const AREA_GAP = 24;

/**
 * The layout of the areas themselves (A63): blocks left to right in
 * production order, areas with no line between them stacked in one column.
 * Rows are no longer wrapped to fit the canvas (B9 until A88): every line
 * from a later row looped back, and an easily followed chart beats one that
 * fits in a single view, so a wide chart scrolls and zooms instead.
 */
const AREA_ROOT_OPTIONS = {
  ...ELK_OPTIONS,
  'elk.spacing.nodeNode': String(AREA_GAP),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(AREA_GAP),
};
/**
 * The first pass only learns each node's port order, which crossing
 * reduction settles; placing and compacting nodes can wait, and a lighter
 * sweep is enough (A63). The second sweeps in full: with the lines' labels
 * in the chart (A93), keeping the first pass's order crosses far more lines.
 */
const ORDER_ONLY = {
  'elk.layered.nodePlacement.strategy': 'SIMPLE',
  'elk.layered.compaction.postCompaction.strategy': 'NONE',
  'elk.layered.thoroughness': '3',
};
/** A gate's size: a point, but ELK wants a box. */
const GATE = 1;
const frameId = (area: string) => `frame:${area}`;
const areaOfFrame = (id: string) =>
  id.startsWith('frame:') ? id.slice('frame:'.length) : undefined;

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

/**
 * The quiet number format (UX-6, A78): 1 to 2 decimals rounded up to the next
 * 0.01, "<0.01" for dust. The same rule as the solver's `formatQuiet`; a
 * tooling test keeps the two equal.
 */
export function quietText(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (rateText(n) === '0.0') return '0.0';
  const size = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const noise = Math.min(1e-9 * Math.max(1, size), 0.01 / 1e4) * 100;
  if (size * 100 < 1 - noise) return `${sign}<0.01`;
  const steps = Math.ceil(size * 100 - noise);
  const whole = String(Math.floor(steps / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(steps % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}.${frac || '0'}`;
}

/** A count of whole things (machines, factories): an integer with commas between thousands (B6). */
export function countText(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The text lines a node shows, which also size it. */
export function nodeLines(n: FlowNode, rate: (n: number) => string = rateText): string[] {
  switch (n.kind) {
    case 'recipe':
    case 'resource': {
      const count = `${rate(n.machines ?? 0)} × ${n.machine ?? ''}`;
      const boiler = n.boilerLoad !== undefined ? [`boiler ${rate(n.boilerLoad * 100)}%`] : [];
      return [n.label, count, ...boiler];
    }
    case 'import':
      return [`Import: ${n.label}`, `${rate(n.rate ?? 0)}/min`];
    case 'missing':
      return [`Missing: ${n.label}`, `${rate(n.rate ?? 0)}/min`];
    case 'target':
      return [
        `Target: ${n.label}`,
        `${rate(n.rate ?? 0)}/min`,
        ...(n.split ? [`For links ${rate(n.split.forLinks)} · Kept ${rate(n.split.kept)}`] : []),
      ];
    case 'byproduct':
      return [`Byproduct: ${n.label}`, `${rate(n.rate ?? 0)}/min`];
    case 'sub-factory':
      return [n.label, 'Sub-factory · double-click to open'];
    case 'area':
      return [n.label, areaStats(n.machines ?? 0, n.power ?? 0)];
  }
}

/** An area's machines and power, as its title bar and collapsed box show them (A63). */
export function areaStats(machines: number, power: number): string {
  const mw = power < 0 ? `${rateText(-power)} MW made` : `${rateText(power)} MW`;
  return `${rateText(machines)} machines · ${mw}`;
}

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

const longest = (lines: readonly string[]) => Math.max(0, ...lines.map((l) => l.length));

/**
 * A raw input: what the plan starts from. Imports, missing inputs, resource
 * nodes (miners and wells, even when they take a fluid) and recipes that
 * take nothing, such as Water.
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
 * The raw inputs used at more than one stage of the plan (A47), such as
 * Water used early for ore and again late for radiators, each with how many
 * stages it feeds. A raw input feeding one stage only, such as an ore going
 * into three smelters side by side, is left out.
 */
export function multiStageInputs(graph: FactoryGraph): Map<string, number> {
  const raw = new Set(graph.nodes.filter(isRaw).map((n) => n.id));
  const stage = stages(graph, raw);
  const out = new Map<string, number>();
  for (const id of raw) {
    const used = new Set(
      graph.edges
        .filter((e) => e.source === id && !raw.has(e.target))
        .map((e) => stage.get(e.target)),
    );
    if (used.size > 1) out.set(id, used.size);
  }
  return out;
}

/**
 * Each node's stage: the longest run of lines leading into it, lines from
 * raw inputs not counted. A line closing a loop is skipped.
 */
function stages(graph: FactoryGraph, raw: ReadonlySet<string>): Map<string, number> {
  const from = new Map<string, string[]>();
  for (const e of graph.edges)
    if (e.source !== e.target && !raw.has(e.source))
      from.set(e.target, [...(from.get(e.target) ?? []), e.source]);
  const stage = new Map<string, number>();
  const open = new Set<string>();
  const visit = (id: string): number => {
    const known = stage.get(id);
    if (known !== undefined) return known;
    if (open.has(id)) return 0;
    open.add(id);
    let s = 0;
    for (const source of from.get(id) ?? []) s = Math.max(s, visit(source) + 1);
    open.delete(id);
    stage.set(id, s);
    return s;
  };
  for (const n of graph.nodes) visit(n.id);
  return stage;
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

type Sized = { node: FlowNode; text: NodeText; width: number; height: number; slant: number };
type Label = { text: string; width: number; height: number };
type Order = { ins: string[]; outs: string[] };

/** How nodes are placed inside each area: the candidates a grouped chart is laid out with (A88). */
const PLACEMENTS = ['BRANDES_KOEPF', 'NETWORK_SIMPLEX'] as const;
type Placement = (typeof PLACEMENTS)[number];

/**
 * Lays the flowchart out left to right: targets and byproducts last. A chart
 * of fewer than `SMALL_PLAN` nodes in two or more open areas is laid out once
 * per placement candidate and the cheapest by `layoutCost` is kept (A88),
 * among those that keep boxes at least `LABEL_CLEAR` apart; ties go to the
 * first candidate. A larger chart gets the first candidate only, which keeps
 * a 150-node plan inside the 2 s budget.
 */
export async function layoutFactoryGraph(
  graph: FactoryGraph,
  engine: LayoutEngine,
  options: LayoutOptions = {},
): Promise<FactoryLayout> {
  const framed = graph.areas?.filter((a) => !a.collapsed).length ?? 0;
  if (framed < 2 || graph.nodes.length >= SMALL_PLAN)
    return layoutWith(graph, engine, options, PLACEMENTS[0]);
  let best: { layout: FactoryLayout; clear: boolean; cost: number } | undefined;
  for (const placement of PLACEMENTS) {
    const layout = await layoutWith(graph, engine, options, placement);
    const s = layoutScore(layout);
    const clear = s.minGap >= LABEL_CLEAR;
    if (!best || (clear && !best.clear) || (clear === best.clear && s.cost < best.cost))
      best = { layout, clear, cost: s.cost };
  }
  return best!.layout;
}

async function layoutWith(
  graph: FactoryGraph,
  engine: LayoutEngine,
  options: LayoutOptions,
  placement: Placement,
): Promise<FactoryLayout> {
  const rate = options.rate ?? rateText;
  const lines = options.nodeLines ?? ((n: FlowNode) => nodeLines(n, rate));
  const icon = options.iconSize ?? 0;
  const iconSpace = icon > 0 ? icon + ICON_GAP : 0;
  const labelIcon = options.labelIconSize ?? 0;
  const labelIconSpace = labelIcon > 0 ? labelIcon + LABEL_ICON_GAP : 0;
  const multi = multiStageInputs(graph);

  const labelOf = (value: number): Label => {
    const text = rate(value);
    return {
      text,
      width: labelIconSpace + text.length * FLOW_CHAR_WIDTH + 2 * LABEL_PAD,
      height: Math.max(FLOW_LINE_HEIGHT, labelIcon) + 2,
    };
  };
  const labels = new Map<string, Label>(graph.edges.map((e) => [e.id, labelOf(e.rate)]));

  const sized = new Map<string, Sized>();
  for (const n of graph.nodes) {
    const text = nodeText(lines(n));
    const textWidth = Math.max(
      longest(text.title) * FLOW_TITLE_CHAR_WIDTH,
      longest(text.details) * FLOW_CHAR_WIDTH,
    );
    // Room for each port, with the main product in the middle of the outputs.
    const side = n.main !== undefined ? Math.ceil((n.outputs.length - 1) / 2) : 0;
    const outRows = n.main !== undefined ? 2 * side + 1 : n.outputs.length;
    const height = Math.max(
      MIN_NODE_HEIGHT,
      (n.inputs.length + 1) * PORT_ROW,
      (outRows + 1) * PORT_ROW,
      Math.max((text.title.length + text.details.length) * FLOW_LINE_HEIGHT, icon) +
        2 * (PADDING_Y + BORDER),
    );
    const slant = Math.round(height * SLANT);
    const width = Math.max(
      MIN_NODE_WIDTH,
      textWidth + iconSpace + 2 * (PADDING_X + BORDER) + 2 * slant,
    );
    sized.set(n.id, { node: n, text, width, height, slant });
  }

  /** Port heights on a node, given the order of its inputs and outputs. */
  const portYs = (s: Sized, order: Order) => {
    const n = s.node;
    const ys = new Map<string, number>();
    order.ins.forEach((i, k) =>
      ys.set(inPort(n.id, i), s.height / 2 + (k - (order.ins.length - 1) / 2) * PORT_ROW),
    );
    const at = n.main !== undefined ? order.outs.indexOf(n.main) : -1;
    order.outs.forEach((o, k) => {
      const off = at >= 0 ? k - at : k - (order.outs.length - 1) / 2;
      ys.set(outPort(n.id, o), s.height / 2 + off * PORT_ROW);
    });
    return ys;
  };

  // Areas (A63): each open area is laid out on its own, then placed as a
  // block. A line crossing an area's border leaves through a gate, one per
  // output, at the area's right edge, and enters through a gate, one per
  // output, at the left edge of each area it feeds. ELK's own compound nodes
  // misplace ports on the edge of a compound node, so the two levels are
  // laid out separately and joined here. A collapsed area is a block too,
  // with its one box and no frame (B2): placed among the frames like an open
  // area, its lines leave and enter through gates the same way, instead of
  // the box being wrapped into rows of its own.
  const open = new Map((graph.areas ?? []).filter((a) => !a.collapsed).map((a) => [a.id, a]));
  const shut = new Set(
    graph.nodes.flatMap((n) => (n.kind === 'area' && n.area !== undefined ? [n.area] : [])),
  );
  const blockIds = (graph.areas ?? [])
    .map((a) => a.id)
    .filter((id) => open.has(id) || shut.has(id));
  const ROOT = '';
  const containerOf = new Map<string, string>();
  for (const n of graph.nodes)
    containerOf.set(
      n.id,
      n.area !== undefined && (n.kind === 'area' ? shut : open).has(n.area) ? n.area : ROOT,
    );
  const segments = graph.edges.map((e) => ({
    id: e.id,
    source: outPort(e.source, e.item),
    target: inPort(e.target, e.item),
    from: e.source,
    to: e.target,
  }));
  const edgesIn = new Map<string, ElkExtendedEdge[]>([[ROOT, []]]);
  /** Gates per area: exits on its right edge, entries on its left. */
  const gatesOf = new Map<string, { id: string; exit: boolean }[]>();
  const made = new Set<string>();
  /** The ELK edge each line's label rides on (A93): its own, or its part in the area it enters. */
  const labelled = new Map<string, string>();
  const addEdge = (
    container: string,
    id: string,
    source: string,
    target: string,
    line?: string,
  ) => {
    if (made.has(id)) return;
    made.add(id);
    const list = edgesIn.get(container) ?? [];
    const l = line !== undefined ? labels.get(line) : undefined;
    if (line !== undefined) labelled.set(line, id);
    list.push({
      id,
      sources: [source],
      targets: [target],
      ...(l
        ? {
            labels: [
              {
                id: `label:${id}`,
                // A margin all round keeps neighbouring labels LABEL_CLEAR apart.
                width: l.width + LABEL_CLEAR,
                height: l.height + LABEL_CLEAR,
                text: l.text,
                layoutOptions: LABEL_OPTIONS,
              },
            ],
          }
        : {}),
    });
    edgesIn.set(container, list);
  };
  const addGate = (area: string, id: string, exit: boolean) => {
    if (made.has(id)) return;
    made.add(id);
    gatesOf.set(area, [...(gatesOf.get(area) ?? []), { id, exit }]);
  };
  /**
   * The ELK edges a segment is drawn along, in order. `exit`: the edge ends
   * at a gate, and the line runs on to the right edge of that area; `entry`:
   * it starts at a gate, and the line comes in from the left edge.
   */
  type Part = { id: string; exit?: string; entry?: string };
  const parts = new Map<string, Part[]>();
  for (const seg of segments) {
    const a = containerOf.get(seg.from) ?? ROOT;
    const b = containerOf.get(seg.to) ?? ROOT;
    if (a === b) {
      addEdge(a, seg.id, seg.source, seg.target, seg.id);
      parts.set(seg.id, [{ id: seg.id }]);
      continue;
    }
    const list: Part[] = [];
    let from = seg.source;
    if (a !== ROOT) {
      const exit = `${a}>${seg.source}`;
      addGate(a, exit, true);
      addEdge(a, `x:${exit}`, seg.source, `${exit}#p`);
      list.push({ id: `x:${exit}`, exit: a });
      from = exit;
    }
    let to = seg.target;
    if (b !== ROOT) {
      const entry = `${b}<${seg.source}`;
      addGate(b, entry, false);
      to = entry;
    }
    addEdge(ROOT, `r:${from}→${to}`, from, to, b === ROOT ? seg.id : undefined);
    list.push({ id: `r:${from}→${to}` });
    if (b !== ROOT) {
      addEdge(b, `i:${seg.id}`, `${to}#p`, seg.target, seg.id);
      list.push({ id: `i:${seg.id}`, entry: b });
    }
    parts.set(seg.id, list);
  }

  const leaf = (n: FlowNode, orders: Map<string, Order> | undefined): ElkNode => {
    const s = sized.get(n.id)!;
    const layer = LAYER[n.kind];
    const order = orders?.get(n.id);
    const width = s.width;
    const ys = order ? portYs(s, order) : undefined;
    const port = (id: string, side: 'EAST' | 'WEST'): ElkPort => ({
      id,
      width: 0,
      height: 0,
      ...(ys ? { x: side === 'EAST' ? width : 0, y: ys.get(id)! } : {}),
      layoutOptions: { 'elk.port.side': side },
    });
    return {
      id: n.id,
      width,
      height: s.height,
      layoutOptions: {
        'elk.portConstraints': order ? 'FIXED_POS' : 'FIXED_SIDE',
        ...(layer ? { 'elk.layered.layering.layerConstraint': layer } : {}),
      },
      ports: [
        ...(order?.ins ?? n.inputs.map((f) => f.item)).map((i) => port(inPort(n.id, i), 'WEST')),
        ...(order?.outs ?? n.outputs.map((f) => f.item)).map((o) => port(outPort(n.id, o), 'EAST')),
      ],
    };
  };
  /** A gate: a point in the area's first or last layer that a crossing line passes. */
  const gate = (g: { id: string; exit: boolean }): ElkNode => ({
    id: g.id,
    width: GATE,
    height: GATE,
    layoutOptions: {
      'elk.portConstraints': 'FIXED_POS',
      'elk.layered.layering.layerConstraint': g.exit ? 'LAST_SEPARATE' : 'FIRST_SEPARATE',
    },
    ports: [
      {
        id: `${g.id}#p`,
        width: 0,
        height: 0,
        x: g.exit ? 0 : GATE,
        y: GATE / 2,
        layoutOptions: { 'elk.port.side': g.exit ? 'WEST' : 'EAST' },
      },
    ],
  });
  const childrenOf = (container: string, orders: Map<string, Order> | undefined) => [
    ...graph.nodes.filter((n) => containerOf.get(n.id) === container).map((n) => leaf(n, orders)),
    ...(gatesOf.get(container) ?? []).map(gate),
  ];

  type Drawn = {
    width: number;
    height: number;
    nodes: Map<string, ElkNode>;
    edges: Map<string, ElkExtendedEdge>;
    frames: Map<string, Box>;
  };
  const shift = (e: ElkExtendedEdge, dx: number, dy: number): ElkExtendedEdge => ({
    ...e,
    ...(e.labels
      ? { labels: e.labels.map((l) => ({ ...l, x: (l.x ?? 0) + dx, y: (l.y ?? 0) + dy })) }
      : {}),
    sections: (e.sections ?? []).map((s) => {
      const at = (p: ElkPoint) => ({ x: p.x + dx, y: p.y + dy });
      return {
        ...s,
        startPoint: at(s.startPoint),
        endPoint: at(s.endPoint),
        ...(s.bendPoints ? { bendPoints: s.bendPoints.map(at) } : {}),
      };
    }),
  });
  /** The first pass leaves labels out: they don't change the port order it learns. */
  const strip = (es: ElkExtendedEdge[], orders: unknown) =>
    orders ? es : es.map(({ labels: _, ...e }) => e);
  /** One layout of the whole chart: each area, then the areas as blocks. */
  const pass = async (orders: Map<string, Order> | undefined): Promise<Drawn> => {
    const inner = new Map<string, ElkNode>();
    for (const id of blockIds) {
      const framed = open.has(id);
      const children = childrenOf(id, orders);
      inner.set(
        id,
        await engine.layout({
          id: frameId(id),
          layoutOptions: {
            ...elkOptions(children.length),
            ...(framed ? { 'elk.layered.nodePlacement.strategy': placement } : {}),
            // Scanline constraints let compaction slide two boxes of
            // neighbouring layers to 4 px apart; quadratic ones keep the
            // spacing (A88).
            ...(framed ? { 'elk.layered.compaction.postCompaction.constraints': 'QUADRATIC' } : {}),
            ...(orders ? {} : ORDER_ONLY),
            'elk.padding': `[top=${PAD + (framed ? AREA_TITLE : 0)},left=${PAD},bottom=${PAD},right=${PAD}]`,
          },
          children,
          edges: strip(edgesIn.get(id) ?? [], orders),
        }),
      );
    }
    const blocks = blockIds.map((id): ElkNode => {
      const box = inner.get(id)!;
      const width = box.width ?? 0;
      return {
        id: frameId(id),
        width,
        height: box.height ?? 0,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: (gatesOf.get(id) ?? []).map((g): ElkPort => {
          const at = box.children?.find((c) => c.id === g.id);
          return {
            id: g.id,
            width: 0,
            height: 0,
            x: g.exit ? width : 0,
            y: (at?.y ?? 0) + GATE / 2,
            layoutOptions: { 'elk.port.side': g.exit ? 'EAST' : 'WEST' },
          };
        }),
      };
    });
    const roots = childrenOf(ROOT, orders);
    // The first pass only learns each node's port order; with no node outside
    // an area, the blocks' places don't matter yet.
    const top: ElkNode =
      !orders && blocks.length && !roots.length
        ? { id: 'root', children: blocks }
        : await engine.layout({
            id: 'root',
            layoutOptions: {
              ...(blocks.length ? AREA_ROOT_OPTIONS : elkOptions(graph.nodes.length)),
              ...(orders ? {} : ORDER_ONLY),
            },
            children: [...blocks, ...roots],
            edges: strip(edgesIn.get(ROOT)!, orders),
          });
    const drawn: Drawn = {
      width: top.width ?? 0,
      height: top.height ?? 0,
      nodes: new Map(),
      edges: new Map(),
      frames: new Map(),
    };
    for (const e of (top.edges ?? []) as ElkExtendedEdge[]) drawn.edges.set(e.id, e);
    for (const c of top.children ?? []) {
      const area = areaOfFrame(c.id);
      const box = area !== undefined ? inner.get(area) : undefined;
      if (area === undefined || !box) {
        drawn.nodes.set(c.id, c);
        continue;
      }
      const dx = c.x ?? 0;
      const dy = c.y ?? 0;
      drawn.frames.set(area, { x: dx, y: dy, width: c.width ?? 0, height: c.height ?? 0 });
      for (const k of box.children ?? [])
        drawn.nodes.set(k.id, { ...k, x: (k.x ?? 0) + dx, y: (k.y ?? 0) + dy });
      for (const e of (box.edges ?? []) as ElkExtendedEdge[])
        drawn.edges.set(e.id, shift(e, dx, dy));
    }
    return drawn;
  };

  // Pass 1: ELK orders each node's ports. Pass 2: the ports keep that order,
  // evenly spaced, the main product in the middle.
  let drawn: Drawn | undefined;
  if (graph.nodes.length) {
    const first = await pass(undefined);
    const orders = new Map<string, Order>();
    for (const n of graph.nodes) {
      const ys = new Map((first.nodes.get(n.id)?.ports ?? []).map((p) => [p.id, p.y ?? 0]));
      const order = (items: readonly { item: string }[], id: (item: string) => string) =>
        items
          .map((f, k) => ({ item: f.item, y: ys.get(id(f.item)) ?? 0, k }))
          .sort((a, b) => a.y - b.y || a.k - b.k)
          .map((p) => p.item);
      orders.set(n.id, {
        ins: order(n.inputs, (i) => inPort(n.id, i)),
        outs: centreMain(
          order(n.outputs, (i) => outPort(n.id, i)),
          n.main,
        ),
      });
    }
    drawn = await pass(orders);
  }
  const placed = drawn?.nodes ?? new Map<string, ElkNode>();
  const routed = drawn?.edges ?? new Map<string, ElkExtendedEdge>();

  const nodePorts = new Map<string, NodePort[]>();
  const box = new Map<string, Box>();
  for (const n of graph.nodes) {
    const s = sized.get(n.id)!;
    const c = placed.get(n.id);
    box.set(n.id, { x: c?.x ?? 0, y: c?.y ?? 0, width: s.width, height: s.height });
    const ports: NodePort[] = [];
    for (const p of c?.ports ?? []) {
      const [, kind = ''] = p.id.slice(n.id.length).split(/[#:]/);
      if (kind !== 'in' && kind !== 'out') continue;
      const item = p.id.slice(n.id.length + kind.length + 2);
      // Lines meet the slanted sides: a port off the vertex sits further in.
      const y = p.y ?? 0;
      const inset = (s.slant * Math.abs(y - s.height / 2)) / (s.height / 2);
      ports.push({ item, dir: kind, x: kind === 'in' ? inset : s.width - inset, y });
    }
    nodePorts.set(n.id, ports);
  }
  const portAt = (node: string, dir: 'in' | 'out', item: string): ElkPoint[] => {
    const b = box.get(node);
    const p = nodePorts.get(node)?.find((q) => q.dir === dir && q.item === item);
    return b && p ? [{ x: b.x + p.x, y: b.y + p.y }] : [];
  };
  const route = (segment: string) =>
    (parts.get(segment) ?? []).flatMap((part) => {
      const points = orthogonal(
        (routed.get(part.id)?.sections ?? []).flatMap((s) => [
          s.startPoint,
          ...(s.bendPoints ?? []),
          s.endPoint,
        ]),
      );
      const exit = part.exit !== undefined ? drawn?.frames.get(part.exit) : undefined;
      const entry = part.entry !== undefined ? drawn?.frames.get(part.entry) : undefined;
      const last = points.at(-1);
      const first = points[0];
      return [
        ...(entry && first ? [{ x: entry.x, y: first.y }] : []),
        ...points,
        ...(exit && last ? [{ x: exit.x + exit.width, y: last.y }] : []),
      ];
    });

  const nodes = graph.nodes.map((n): PlacedNode => {
    const stagesFed = multi.get(n.id);
    return {
      ...n,
      ...box.get(n.id)!,
      text: sized.get(n.id)!.text,
      ports: nodePorts.get(n.id)!,
      slant: sized.get(n.id)!.slant,
      ...(stagesFed !== undefined ? { stages: stagesFed } : {}),
    };
  });
  const edges = graph.edges.map((e): PlacedEdge => {
    const l = labels.get(e.id)!;
    const at = routed.get(labelled.get(e.id) ?? '')?.labels?.[0];
    return {
      ...e,
      points: join(portAt(e.source, 'out', e.item), route(e.id), portAt(e.target, 'in', e.item)),
      label: {
        x: (at?.x ?? 0) + LABEL_CLEAR / 2,
        y: (at?.y ?? 0) + LABEL_CLEAR / 2,
        width: l.width,
        height: l.height,
        text: l.text,
      },
    };
  });
  const areas = [...open.values()].flatMap((a): PlacedArea[] => {
    const frame = drawn?.frames.get(a.id);
    return frame ? [{ ...a, ...frame }] : [];
  });
  return { width: drawn?.width ?? 0, height: drawn?.height ?? 0, nodes, edges, areas };
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
