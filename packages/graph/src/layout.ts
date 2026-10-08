/**
 * ELK layered layout of a factory flowchart (docs/ARCHITECTURE.md §8).
 *
 * The ELK engine is injected: the web app runs it in its own worker, tests
 * run the bundled engine in Node. Node and label sizes are estimated from
 * their text, never measured, and ELK runs with a fixed seed, so identical
 * graphs always get identical coordinates.
 *
 * Ports and labels (A46, A48): every node has one port per item it takes,
 * on the left slanted sides of its hexagon, and one per item it makes, on
 * the right edge of its output tray, the main product in the middle. Each
 * line's label (icon and rate) sits just before the port it enters. ELK lays
 * the chart out twice: once free to order each node's ports, to learn the
 * order with the fewest crossings, then with the ports fixed in that order.
 */
import type { ElkExtendedEdge, ElkNode, ElkPoint, ElkPort } from 'elkjs/lib/elk-api';
import type { FactoryGraph, FlowEdge, FlowNode, FlowNodeKind, GraphArea } from './factory';

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

/** One row of a node's output tray (A48): an item it makes, centred on its port. */
export interface TrayRow {
  item: string;
  rate: number;
  /** The row's centre, relative to the node's box. */
  y: number;
}

/**
 * A node as drawn: a hexagon with vertices left and right (A40), and right
 * of it the output tray (A48), `tray` wide, one row per item the node makes.
 * `slant` is how far the hexagon's slanted sides reach in from its left and
 * right edges; the text sits between them. `stages`: a raw input feeding
 * recipes at that many stages of the plan (2 or more), drawn marked (A47).
 */
export type PlacedNode = FlowNode &
  Box & {
    text: NodeText;
    slant: number;
    tray: number;
    rows: TrayRow[];
    ports: NodePort[];
    stages?: number;
  };

export interface PlacedEdge extends FlowEdge {
  /** The routed polyline, start to end (orthogonal segments). */
  points: ElkPoint[];
  /** Just before the port the line enters, above the line (A48). */
  label: Box & { text: string };
}

/**
 * One output that feeds several consumers (A46): the lines share a trunk
 * labelled with the total, and each branch is labelled with its rate.
 */
export interface Bundle {
  source: string;
  item: string;
  rate: number;
  /** Where the trunk splits into branches. */
  split: ElkPoint;
  /** Just before the split point, above the trunk. */
  label: Box & { text: string };
}

/** An area's frame (A63): its box, with the title bar along its top. */
export type PlacedArea = GraphArea & Box;

export interface FactoryLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  bundles: Bundle[];
  /** Frames of the open areas of a grouped plan (A63). */
  areas?: PlacedArea[];
}

export interface LayoutOptions {
  /** Node text lines, used to size it. Default: `nodeLines`. */
  nodeLines?: (n: FlowNode) => string[];
  /**
   * Side of a square icon drawn left of each node's text, in px. Default 0
   * (no icon). Nodes grow by the icon and its gap, and are at least as tall.
   */
  iconSize?: number;
  /**
   * Side of the item icon drawn before the rate in every line label and tray
   * row (A48), in px. Default 0 (no icon).
   */
  labelIconSize?: number;
}

/** Space between a node's icon and its text. */
export const ICON_GAP = 6;
/** Space between a label's item icon and its rate. */
export const LABEL_ICON_GAP = 3;
/** Padding either side of a tray row's icon and rate. */
export const TRAY_PAD = 4;

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
/** Slanted sides at 60° to the flat top and bottom: they reach in tan 30° × height / 2. */
const SLANT = Math.tan(Math.PI / 6) / 2;
/** Shortest hexagon, so short nodes keep clear vertices for their edges. */
const MIN_NODE_HEIGHT = 44;
/** Wrap width, in characters, of node text. */
const NODE_CHARS = 18;
/** The drawing's margin. */
const PAD = 8;
/** A label's clearance from the node it sits beside (A43's gap floor is 6). */
const LABEL_CLEAR = 6;
/** Gap between a label and the line under it. */
const LABEL_LIFT = 2;
/** One row of labels before a node's inputs, with the clearance between rows. */
const LABEL_ROW = FLOW_LINE_HEIGHT + LABEL_CLEAR;

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
/** Space between area frames, and around the lines between them. */
const AREA_GAP = 24;

/**
 * The layout of the areas themselves (A63): blocks left to right in
 * production order, wrapped into rows between areas (B9) so the drawing is
 * about twice as wide as it is tall, like the canvas.
 */
const AREA_ROOT_OPTIONS = {
  ...ELK_OPTIONS,
  'elk.spacing.nodeNode': String(AREA_GAP),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(AREA_GAP),
  'elk.layered.wrapping.strategy': 'MULTI_EDGE',
  'elk.aspectRatio': '2',
};
/**
 * A grouped plan's first pass only learns each node's port order, which
 * crossing reduction settles; placing and compacting nodes can wait, and a
 * lighter sweep is enough (A63).
 */
const ORDER_ONLY = {
  'elk.layered.nodePlacement.strategy': 'SIMPLE',
  'elk.layered.compaction.postCompaction.strategy': 'NONE',
  'elk.layered.thoroughness': '3',
};
/**
 * The second pass keeps the first pass's order of nodes in each layer, read
 * from where it put them, instead of sweeping again (A63).
 */
const KEEP_ORDER = { 'elk.layered.crossingMinimization.strategy': 'INTERACTIVE' };
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

/** How far in from the hexagon's edge its slanted side is at height `y`. */
const reach = (h: number, slant: number, y: number) => (slant * Math.abs(y - h / 2)) / (h / 2);

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

type Sized = {
  node: FlowNode;
  text: NodeText;
  /** The hexagon's size; the tray sits right of it, `pad` room left of it. */
  width: number;
  height: number;
  slant: number;
  tray: number;
  /** Room left of the hexagon for the labels of lines coming in. */
  pad: number;
};
type Label = { text: string; width: number; height: number };
type Order = { ins: string[]; outs: string[] };

/** Lays the flowchart out left to right: targets and byproducts last. */
export async function layoutFactoryGraph(
  graph: FactoryGraph,
  engine: LayoutEngine,
  options: LayoutOptions = {},
): Promise<FactoryLayout> {
  const lines = options.nodeLines ?? nodeLines;
  const icon = options.iconSize ?? 0;
  const iconSpace = icon > 0 ? icon + ICON_GAP : 0;
  const labelIcon = options.labelIconSize ?? 0;
  const labelIconSpace = labelIcon > 0 ? labelIcon + LABEL_ICON_GAP : 0;
  const multi = multiStageInputs(graph);
  /** A tray row's height: its icon or its text, and a little air. */
  const trayRow = Math.max(FLOW_LINE_HEIGHT, labelIcon) + 4;

  // An output feeding two or more lines is a bundle.
  const fanOut = new Map<string, FlowEdge[]>();
  for (const e of graph.edges) {
    const key = `${e.source}\n${e.item}`;
    fanOut.set(key, [...(fanOut.get(key) ?? []), e]);
  }
  const bundled = new Map([...fanOut].filter(([, list]) => list.length > 1));
  const isBranch = (e: FlowEdge) => bundled.has(`${e.source}\n${e.item}`);
  const labelOf = (rate: number): Label => {
    const text = rateText(rate);
    return {
      text,
      width: labelIconSpace + text.length * FLOW_CHAR_WIDTH,
      height: Math.max(FLOW_LINE_HEIGHT, labelIcon),
    };
  };
  const labels = new Map<string, Label>(graph.edges.map((e) => [e.id, labelOf(e.rate)]));
  // Each bundle's trunk runs from its output to a split point, a node of its
  // own wide enough for the trunk's label, where the branches leave.
  const trunks = [...bundled.values()].map((list) => {
    const first = list[0]!;
    const rate = list.reduce((s, e) => s + e.rate, 0);
    const label = labelOf(rate);
    return {
      first,
      rate,
      split: splitNode(first.source, first.item),
      label,
      width: label.width + LABEL_CLEAR,
      height: 2 * (label.height + LABEL_LIFT) + 2,
    };
  });
  const splitOf = (e: FlowEdge) => (isBranch(e) ? splitNode(e.source, e.item) : undefined);

  // How many lines enter each input port: their labels stack above it.
  const into = new Map<string, FlowEdge[]>();
  for (const e of graph.edges) {
    const key = inPort(e.target, e.item);
    into.set(key, [...(into.get(key) ?? []), e]);
  }
  const rowsBefore = (n: FlowNode, item: string) =>
    Math.max(1, into.get(inPort(n.id, item))?.length ?? 0);

  const sized = new Map<string, Sized>();
  for (const n of graph.nodes) {
    const text = nodeText(lines(n));
    const textWidth = Math.max(
      longest(text.title) * FLOW_TITLE_CHAR_WIDTH,
      longest(text.details) * FLOW_CHAR_WIDTH,
    );
    // Room for each input's label rows, and for the tray's rows with the
    // main product in the middle.
    const inRows = n.inputs.reduce((s, f) => s + rowsBefore(n, f.item), 0);
    const side = n.main !== undefined ? Math.ceil((n.outputs.length - 1) / 2) : 0;
    const outRows = n.main !== undefined ? 2 * side + 1 : n.outputs.length;
    const height = Math.max(
      MIN_NODE_HEIGHT,
      inRows * LABEL_ROW,
      outRows * trayRow,
      Math.max((text.title.length + text.details.length) * FLOW_LINE_HEIGHT, icon) +
        2 * (PADDING_Y + BORDER),
    );
    const slant = Math.round(height * SLANT);
    const width = Math.max(
      MIN_NODE_WIDTH,
      textWidth + iconSpace + 2 * (PADDING_X + BORDER) + 2 * slant,
    );
    const tray = n.outputs.length
      ? 2 * TRAY_PAD +
        labelIconSpace +
        longest(n.outputs.map((f) => rateText(f.rate))) * FLOW_CHAR_WIDTH
      : 0;
    const inLabels = n.inputs.flatMap((f) => into.get(inPort(n.id, f.item)) ?? []);
    const pad = inLabels.length
      ? Math.max(...inLabels.map((e) => labels.get(e.id)!.width)) + LABEL_CLEAR + 2
      : 0;
    sized.set(n.id, { node: n, text, width, height, slant, tray, pad });
  }

  /** Port heights on a node, given the order of its inputs and outputs. */
  const portYs = (s: Sized, order: Order) => {
    const n = s.node;
    const ys = new Map<string, number>();
    const inRows = order.ins.reduce((t, i) => t + rowsBefore(n, i), 0);
    // Each input's port at the foot of its rows of labels.
    let row = (s.height - inRows * LABEL_ROW) / 2;
    for (const i of order.ins) {
      row += rowsBefore(n, i) * LABEL_ROW;
      ys.set(inPort(n.id, i), row - LABEL_CLEAR / 2);
    }
    const at = n.main !== undefined ? order.outs.indexOf(n.main) : -1;
    order.outs.forEach((o, k) => {
      const off = at >= 0 ? k - at : k - (order.outs.length - 1) / 2;
      ys.set(outPort(n.id, o), s.height / 2 + off * trayRow);
    });
    return ys;
  };

  // Areas (A63): each open area is laid out on its own, then placed as a
  // block. A line crossing an area's border leaves through a gate, one per
  // output, at the area's right edge, and enters through a gate, one per
  // output, at the left edge of each area it feeds. ELK's own compound nodes
  // misplace ports on the edge of a compound node, so the two levels are
  // laid out separately and joined here.
  const open = new Map((graph.areas ?? []).filter((a) => !a.collapsed).map((a) => [a.id, a]));
  const ROOT = '';
  const containerOf = new Map<string, string>();
  for (const n of graph.nodes)
    containerOf.set(
      n.id,
      n.kind !== 'area' && n.area !== undefined && open.has(n.area) ? n.area : ROOT,
    );
  for (const t of trunks) containerOf.set(t.split, containerOf.get(t.first.source)!);
  const segments = [
    ...graph.edges.map((e) => ({
      id: e.id,
      source: splitOf(e) ? `${splitOf(e)!}#out` : outPort(e.source, e.item),
      target: inPort(e.target, e.item),
      from: splitOf(e) ?? e.source,
      to: e.target,
    })),
    ...trunks.map((t) => ({
      id: t.split,
      source: outPort(t.first.source, t.first.item),
      target: `${t.split}#in`,
      from: t.first.source,
      to: t.split,
    })),
  ];
  const edgesIn = new Map<string, ElkExtendedEdge[]>([[ROOT, []]]);
  /** Gates per area: exits on its right edge, entries on its left. */
  const gatesOf = new Map<string, { id: string; exit: boolean }[]>();
  const made = new Set<string>();
  const addEdge = (container: string, id: string, source: string, target: string) => {
    if (made.has(id)) return;
    made.add(id);
    const list = edgesIn.get(container) ?? [];
    list.push({ id, sources: [source], targets: [target] });
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
      addEdge(a, seg.id, seg.source, seg.target);
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
    addEdge(ROOT, `r:${from}→${to}`, from, to);
    list.push({ id: `r:${from}→${to}` });
    if (b !== ROOT) {
      addEdge(b, `i:${seg.id}`, `${to}#p`, seg.target);
      list.push({ id: `i:${seg.id}`, entry: b });
    }
    parts.set(seg.id, list);
  }

  const leaf = (n: FlowNode, orders: Map<string, Order> | undefined): ElkNode => {
    const s = sized.get(n.id)!;
    const layer = LAYER[n.kind];
    const order = orders?.get(n.id);
    const width = s.pad + s.width + s.tray;
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
  const splitBox = (t: (typeof trunks)[number], fixed: boolean): ElkNode => ({
    id: t.split,
    width: t.width,
    height: t.height,
    layoutOptions: { 'elk.portConstraints': fixed ? 'FIXED_POS' : 'FIXED_SIDE' },
    ports: (['in', 'out'] as const).map((dir) => ({
      id: `${t.split}#${dir}`,
      width: 0,
      height: 0,
      ...(fixed ? { x: dir === 'in' ? 0 : t.width, y: t.height / 2 } : {}),
      layoutOptions: { 'elk.port.side': dir === 'in' ? 'WEST' : 'EAST' },
    })),
  });
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
    ...trunks
      .filter((t) => containerOf.get(t.split) === container)
      .map((t) => splitBox(t, orders !== undefined)),
    ...(gatesOf.get(container) ?? []).map(gate),
  ];

  type Drawn = {
    width: number;
    height: number;
    nodes: Map<string, ElkNode>;
    edges: Map<string, ElkExtendedEdge>;
    frames: Map<string, Box>;
    /** Nodes in their areas' own coordinates. */
    local: Map<string, ElkNode>;
  };
  const shift = (e: ElkExtendedEdge, dx: number, dy: number): ElkExtendedEdge => ({
    ...e,
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
  /** One layout of the whole chart: each area, then the areas as blocks. */
  const pass = async (
    orders: Map<string, Order> | undefined,
    seen?: Map<string, ElkNode>,
  ): Promise<Drawn> => {
    const inner = new Map<string, ElkNode>();
    for (const a of open.values()) {
      // The second pass starts each node where the first left it.
      const children = childrenOf(a.id, orders).map((c) => {
        const at = seen?.get(c.id);
        return at ? { ...c, x: at.x ?? 0, y: at.y ?? 0 } : c;
      });
      inner.set(
        a.id,
        await engine.layout({
          id: frameId(a.id),
          layoutOptions: {
            ...elkOptions(children.length),
            ...(orders ? {} : ORDER_ONLY),
            ...(seen ? KEEP_ORDER : {}),
            'elk.padding': `[top=${PAD + AREA_TITLE},left=${PAD},bottom=${PAD},right=${PAD}]`,
          },
          children,
          edges: edgesIn.get(a.id) ?? [],
        }),
      );
    }
    const blocks = [...open.keys()].map((id): ElkNode => {
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
      !orders && open.size && !roots.length
        ? { id: 'root', children: blocks }
        : await engine.layout({
            id: 'root',
            layoutOptions: open.size ? AREA_ROOT_OPTIONS : elkOptions(graph.nodes.length),
            children: [...blocks, ...roots],
            edges: edgesIn.get(ROOT)!,
          });
    const drawn: Drawn = {
      width: top.width ?? 0,
      height: top.height ?? 0,
      nodes: new Map(),
      edges: new Map(),
      frames: new Map(),
      local: new Map([...inner.values()].flatMap((b) => (b.children ?? []).map((k) => [k.id, k]))),
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
  // spaced for their labels and tray rows, the main product in the middle.
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
    drawn = await pass(orders, first.local);
  }
  const placed = drawn?.nodes ?? new Map<string, ElkNode>();
  const routed = drawn?.edges ?? new Map<string, ElkExtendedEdge>();

  // The hexagon sits right of its label room; inputs meet its slanted side,
  // outputs leave from the tray's right edge.
  const hex = new Map<string, Box>();
  const nodePorts = new Map<string, NodePort[]>();
  for (const n of graph.nodes) {
    const s = sized.get(n.id)!;
    const c = placed.get(n.id);
    hex.set(n.id, {
      x: (c?.x ?? 0) + s.pad,
      y: c?.y ?? 0,
      width: s.width + s.tray,
      height: s.height,
    });
    const ports: NodePort[] = [];
    for (const p of c?.ports ?? []) {
      const [, kind = ''] = p.id.slice(n.id.length).split(/[#:]/);
      if (kind !== 'in' && kind !== 'out') continue;
      const item = p.id.slice(n.id.length + kind.length + 2);
      const y = p.y ?? 0;
      ports.push({
        item,
        dir: kind,
        x: kind === 'in' ? reach(s.height, s.slant, y) : s.width + s.tray,
        y,
      });
    }
    nodePorts.set(n.id, ports);
  }
  const portAt = (node: string, dir: 'in' | 'out', item: string): ElkPoint[] => {
    const h = hex.get(node);
    const p = nodePorts.get(node)?.find((q) => q.dir === dir && q.item === item);
    return h && p ? [{ x: h.x + p.x, y: h.y + p.y }] : [];
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
    const s = sized.get(n.id)!;
    const ports = nodePorts.get(n.id)!;
    const stagesFed = multi.get(n.id);
    return {
      ...n,
      ...hex.get(n.id)!,
      text: s.text,
      slant: s.slant,
      tray: s.tray,
      rows: n.outputs.map((f) => ({
        item: f.item,
        rate: f.rate,
        y: ports.find((p) => p.dir === 'out' && p.item === f.item)?.y ?? s.height / 2,
      })),
      ports,
      ...(stagesFed !== undefined ? { stages: stagesFed } : {}),
    };
  });
  // Labels of lines entering one port stack upwards from it.
  const stacked = new Map<string, number>();
  const edges = graph.edges.map((e): PlacedEdge => {
    const l = labels.get(e.id)!;
    const split = splitOf(e);
    const points = [...(split ? route(split) : []), ...route(e.id)];
    const end = portAt(e.target, 'in', e.item);
    const key = inPort(e.target, e.item);
    const row = stacked.get(key) ?? 0;
    stacked.set(key, row + 1);
    const h = hex.get(e.target)!;
    const y = end[0]?.y ?? h.y;
    return {
      ...e,
      points: join(portAt(e.source, 'out', e.item), points, end),
      label: {
        x: h.x - LABEL_CLEAR - l.width,
        y: y - LABEL_LIFT - l.height - row * LABEL_ROW,
        width: l.width,
        height: l.height,
        text: l.text,
      },
    };
  });
  const bundles = trunks.map((t): Bundle => {
    const s = placed.get(t.split);
    const x = (s?.x ?? 0) + t.width;
    const y = (s?.y ?? 0) + t.height / 2;
    return {
      source: t.first.source,
      item: t.first.item,
      rate: t.rate,
      split: { x, y },
      label: {
        x: x - LABEL_CLEAR / 2 - t.label.width,
        y: y - LABEL_LIFT - t.label.height,
        width: t.label.width,
        height: t.label.height,
        text: t.label.text,
      },
    };
  });
  const areas = [...open.values()].flatMap((a): PlacedArea[] => {
    const box = drawn?.frames.get(a.id);
    return box ? [{ ...a, ...box }] : [];
  });
  return { width: drawn?.width ?? 0, height: drawn?.height ?? 0, nodes, edges, bundles, areas };
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
    ...layout.bundles.map((b): [string, Box] => [`trunk ${b.source}:${b.item}`, b.label]),
  ];
  const found: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (intersect(boxes[i]![1], boxes[j]![1])) found.push(`${boxes[i]![0]} × ${boxes[j]![0]}`);
  return found;
}
