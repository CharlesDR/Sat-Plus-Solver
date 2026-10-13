/**
 * ELK layout of the world graph (PLAN M8), like the factory flowchart's
 * (A25): the engine is injected, sizes are estimated from text, and ELK runs
 * with a fixed seed, so the same graph always gets the same coordinates.
 *
 * Expanded groups are ELK compound nodes laid out with their members. Node
 * positions are relative to the enclosing group (as React Flow's sub-flows
 * expect); edge routes and labels are in root coordinates.
 *
 * Ports (A80): each card has one port per part down its sides. ELK lays the
 * world out twice, like the flowchart (A46): first with one port per edge end,
 * free on its side, to learn the order with the fewest crossings; then with
 * the part ports fixed in that order, each edge's parts kept together. ELK
 * routes each edge's trunk from the middle of its parts on one card to the
 * middle of its parts on the other; short fans join the other parts to it.
 */
import type { ElkExtendedEdge, ElkLabel, ElkNode, ElkPoint, ElkPort } from 'elkjs/lib/elk-api';
import {
  CHAR_WIDTH,
  countText,
  LINE_HEIGHT,
  rateText,
  type Box,
  type LayoutEngine,
} from './layout';
import type { WorldEdge, WorldGraph, WorldNode } from './world';

/** The "…" port's place in `PlacedWorldNode.ports.out`. */
export const MORE_PORT = '…';

export type PlacedWorldNode = WorldNode &
  Box & {
    /** Part ids down each side, top to bottom (A80); `MORE_PORT` is the "…" port. */
    ports: { in: string[]; out: string[] };
  };

export interface PlacedWorldEdge extends WorldEdge {
  /** The trunk, from the source's port to the target's. */
  points: ElkPoint[];
  /** Polylines joining each of the edge's other ports to the trunk. */
  fans: ElkPoint[][];
  label: Box & { lines: string[] };
}

export interface WorldLayout {
  width: number;
  height: number;
  /** In `graph.nodes` order; x/y relative to the parent group's frame. */
  nodes: PlacedWorldNode[];
  edges: PlacedWorldEdge[];
}

const PADDING_X = 12;
const PADDING_Y = 8;
const MIN_NODE_WIDTH = 150;
const MAX_NODE_CHARS = 40;
/** Room above a group frame's members for its title bar. */
export const GROUP_HEADER = 36;
/** Room below a factory's or collapsed group's text for its Open/Expand button. */
export const ACTION_ROW = 24;
/** The room an icon takes beside an edge label line. */
export const LABEL_ICON = 20;
/** A port's row on a card's side (A80), and the room above the first one. */
export const PORT_ROW = 22;
export const PORT_TOP = 8;
/** The column of port icons inside a card's edge. */
export const PORT_COL = 22;
/** Longest fan from a port to its edge's trunk. */
const FAN = 12;

/** A port's ELK id. */
export const portId = (node: string, side: 'in' | 'out', item: string) => `${node}|${side}|${item}`;
/** A port's centre below its card's top. */
export const portY = (slot: number) => PORT_TOP + slot * PORT_ROW + PORT_ROW / 2;

const ELK_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.randomSeed': '1',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.json.edgeCoords': 'ROOT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.spacing.nodeNode': '32',
  'elk.spacing.edgeNode': '16',
  'elk.spacing.edgeEdge': '8',
  'elk.spacing.edgeLabel': '4',
  'elk.layered.spacing.nodeNodeBetweenLayers': '56',
  'elk.layered.spacing.edgeNodeBetweenLayers': '16',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.thoroughness': '3',
  'elk.padding': '[top=16,left=16,bottom=16,right=16]',
};

const GROUP_OPTIONS = {
  'elk.padding': `[top=${GROUP_HEADER},left=16,bottom=16,right=16]`,
  'elk.nodeSize.constraints': 'MINIMUM_SIZE',
  'elk.nodeSize.minimum': `(${MIN_NODE_WIDTH}, ${GROUP_HEADER + 32})`,
};

/** A card's figures are whole numbers; a little that would round to 0 shows as "<1". */
const whole = (n: number) => (n > 0 && n < 0.5 ? '<1' : countText(n));
const mw = (n: number) => `${whole(n)} MW`;

/** Power, raw extraction and machines of a factory or collapsed group, one line each. */
function badges(n: WorldNode): string[] {
  const p = n.power;
  const power = !p
    ? []
    : p.generationMW > 0
      ? [`${mw(p.consumptionMW)} draw · ${mw(p.generationMW)} gen`]
      : [`${mw(p.consumptionMW)} draw`];
  const machines = `${countText(n.machines ?? 0)} machines`;
  const raw = n.rawExtracted ?? 0;
  return [...power, raw > 0 ? `${whole(raw)}/min raw extracted · ${machines}` : machines];
}

/** The text lines a node shows, which also size it. */
export function worldNodeLines(n: WorldNode): string[] {
  switch (n.kind) {
    case 'factory':
      return [
        n.label,
        `Status: ${n.status ?? 'empty'}${n.manual ? ' · Manual' : ''}`,
        ...badges(n),
      ];
    case 'group':
      if (!n.collapsed) return [n.label];
      if (n.nest)
        return [
          n.label,
          `With ${(n.members ?? 1) - 1} sub-factories · ${n.status ?? 'ok'}`,
          ...badges(n),
        ];
      return [n.label, `Group of ${n.members ?? 0} · ${n.status ?? 'empty'}`, ...badges(n)];
  }
}

/** One line per item: "rate name", plus how short it is. */
export function worldEdgeLines(e: WorldEdge): string[] {
  return e.items.map(
    (i) => `${rateText(i.rate)} ${i.name}${i.short > 1e-6 ? ` (short ${rateText(i.short)})` : ''}`,
  );
}

const textWidth = (lines: readonly string[]) =>
  Math.min(MAX_NODE_CHARS, Math.max(0, ...lines.map((l) => l.length))) * CHAR_WIDTH;

type Order = { in: string[]; out: string[] };

/** A card's ports before the layout orders them: by part name, "…" last. */
const namedOrder = (n: WorldNode): Order => ({
  in: (n.inPorts ?? []).map((p) => p.item),
  out: [...(n.outPorts ?? []).map((p) => p.item), ...(n.more?.length ? [MORE_PORT] : [])],
});

const box = (s: { x?: number; y?: number; width?: number; height?: number } | undefined) => ({
  x: s?.x ?? 0,
  y: s?.y ?? 0,
  width: s?.width ?? 0,
  height: s?.height ?? 0,
});

export async function layoutWorldGraph(
  graph: WorldGraph,
  engine: LayoutEngine,
): Promise<WorldLayout> {
  const lines = new Map(graph.edges.map((e) => [e.id, worldEdgeLines(e)]));
  const sizes = new Map<string, { width: number; height: number }>();
  for (const n of graph.nodes) {
    if (n.kind === 'group' && !n.collapsed) continue;
    const text = worldNodeLines(n);
    const o = namedOrder(n);
    const cols = (o.in.length ? PORT_COL : 0) + (o.out.length ? PORT_COL : 0);
    sizes.set(n.id, {
      width: Math.max(MIN_NODE_WIDTH, textWidth(text) + 2 * PADDING_X + cols),
      height: Math.max(
        text.length * LINE_HEIGHT + 2 * PADDING_Y + ACTION_ROW + (n.build ? LINE_HEIGHT : 0),
        2 * PORT_TOP + Math.max(o.in.length, o.out.length) * PORT_ROW,
      ),
    });
  }

  const build = (orders: Map<string, Order> | undefined): ElkNode => {
    const elk = new Map<string, ElkNode>();
    const root: ElkNode = { id: 'root', layoutOptions: ELK_OPTIONS, children: [], edges: [] };
    for (const n of graph.nodes) {
      const size = sizes.get(n.id);
      let node: ElkNode;
      if (!size)
        node = {
          id: n.id,
          layoutOptions: GROUP_OPTIONS,
          children: [],
          width: Math.max(MIN_NODE_WIDTH, textWidth([n.label]) + 2 * PADDING_X + 80),
        };
      else if (orders) {
        // Second pass: every part's port, fixed where the card draws it.
        const o = orders.get(n.id)!;
        const port = (side: 'in' | 'out', item: string, slot: number): ElkPort => ({
          id: portId(n.id, side, item),
          width: 0,
          height: 0,
          x: side === 'out' ? size.width : 0,
          y: portY(slot),
          layoutOptions: { 'elk.port.side': side === 'out' ? 'EAST' : 'WEST' },
        });
        node = {
          id: n.id,
          ...size,
          layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
          ports: [
            ...o.in.map((item, k) => port('in', item, k)),
            ...o.out.map((item, k) => port('out', item, k)),
          ],
        };
      } else {
        // First pass: one port per edge end, free on its side.
        node = {
          id: n.id,
          ...size,
          layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
          ports: graph.edges.flatMap((e): ElkPort[] =>
            e.source === n.id
              ? [{ id: `${e.id}|s`, layoutOptions: { 'elk.port.side': 'EAST' } }]
              : e.target === n.id
                ? [{ id: `${e.id}|t`, layoutOptions: { 'elk.port.side': 'WEST' } }]
                : [],
          ),
        };
      }
      elk.set(n.id, node);
      const parent = n.parent ? elk.get(n.parent) : root;
      (parent ?? root).children!.push(node);
    }
    root.edges = graph.edges.map((e): ElkExtendedEdge => {
      const l = lines.get(e.id)!;
      return {
        id: e.id,
        sources: [orders ? trunkPort(e, 'out', orders.get(e.source)!) : `${e.id}|s`],
        targets: [orders ? trunkPort(e, 'in', orders.get(e.target)!) : `${e.id}|t`],
        labels: [
          { text: l.join('\n'), width: textWidth(l) + LABEL_ICON, height: l.length * LINE_HEIGHT },
        ],
      };
    });
    return root;
  };

  const placedOf = (out: ElkNode) => {
    const placed = new Map<string, ElkNode>();
    const walk = (n: ElkNode) => {
      for (const c of n.children ?? []) {
        placed.set(c.id, c);
        walk(c);
      }
    };
    walk(out);
    return placed;
  };

  // Pass 1: where each edge leaves and enters, top to bottom.
  const first = placedOf(await engine.layout(build(undefined)));
  const orders = new Map<string, Order>();
  for (const n of graph.nodes) {
    if (!sizes.has(n.id)) continue;
    const y = new Map((first.get(n.id)?.ports ?? []).map((p) => [p.id, p.y ?? 0]));
    const side = (dir: 'in' | 'out', named: string[]) => {
      const mine = graph.edges
        .filter((e) => (dir === 'out' ? e.source : e.target) === n.id)
        .map((e) => ({ e, y: y.get(`${e.id}|${dir === 'out' ? 's' : 't'}`) ?? 0 }))
        .sort((a, b) => a.y - b.y || byKey(a.e.id, b.e.id));
      const order: string[] = [];
      for (const { e } of mine)
        for (const item of named)
          if (!order.includes(item) && e.items.some((i) => i.item === item)) order.push(item);
      return [...order, ...named.filter((item) => !order.includes(item))];
    };
    const named = namedOrder(n);
    orders.set(n.id, { in: side('in', named.in), out: side('out', named.out) });
  }

  // Pass 2: the part ports fixed in that order.
  const out = await engine.layout(build(orders));
  const placed = placedOf(out);
  const routed = new Map(((out.edges ?? []) as ElkExtendedEdge[]).map((e) => [e.id, e]));
  const nodes = graph.nodes.map((n) => ({
    ...n,
    ...box(placed.get(n.id)),
    ports: orders.get(n.id) ?? { in: [], out: [] },
  }));
  const layout: WorldLayout = {
    width: out.width ?? 0,
    height: out.height ?? 0,
    nodes,
    edges: [],
  };
  layout.edges = graph.edges.map((e) => {
    const r = routed.get(e.id);
    const label: ElkLabel | undefined = r?.labels?.[0];
    const points = (r?.sections ?? []).flatMap((s) => [
      s.startPoint,
      ...(s.bendPoints ?? []),
      s.endPoint,
    ]);
    return {
      ...e,
      points,
      fans: points.length >= 2 ? fans(layout, e, points) : [],
      label: { ...box(label), lines: lines.get(e.id)! },
    };
  });
  return layout;
}

/** The port an edge's trunk uses on one card: the middle of its parts there. */
function trunkPort(e: WorldEdge, side: 'in' | 'out', order: Order): string {
  const slots = slotsOf(e, side, order);
  const node = side === 'out' ? e.source : e.target;
  return portId(node, side, order[side][slots[Math.floor((slots.length - 1) / 2)] ?? 0]!);
}

/** Where an edge's parts sit on one side of a card, top to bottom. */
const slotsOf = (e: WorldEdge, side: 'in' | 'out', order: Order) =>
  e.items
    .map((i) => order[side].indexOf(i.item))
    .filter((k) => k >= 0)
    .sort((a, b) => a - b);

/** Lines from each of an edge's other ports to its trunk, beside each card. */
function fans(layout: WorldLayout, e: WorldEdge, points: ElkPoint[]): ElkPoint[][] {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const out: ElkPoint[][] = [];
  const s = byId.get(e.source)!;
  const t = byId.get(e.target)!;
  const [p0, p1] = [points[0]!, points[1]!];
  const [pn, pm] = [points.at(-1)!, points.at(-2)!];
  const sAt = absolutePosition(layout, s.id);
  const sx = sAt.x + s.width;
  const sm = sx + Math.max(4, Math.min(FAN, (p1.x - sx) / 2));
  for (const k of slotsOf(e, 'out', s.ports)) {
    const y = sAt.y + portY(k);
    if (Math.abs(y - p0.y) > 0.5)
      out.push([
        { x: sx, y },
        { x: sm, y },
        { x: sm, y: p0.y },
      ]);
  }
  const tAt = absolutePosition(layout, t.id);
  const tx = tAt.x;
  const tm = tx - Math.max(4, Math.min(FAN, (tx - pm.x) / 2));
  for (const k of slotsOf(e, 'in', t.ports)) {
    const y = tAt.y + portY(k);
    if (Math.abs(y - pn.y) > 0.5)
      out.push([
        { x: tm, y: pn.y },
        { x: tm, y },
        { x: tx, y },
      ]);
  }
  return out;
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A node's position in root coordinates (adds up its frames' offsets). */
export function absolutePosition(layout: WorldLayout, id: string): { x: number; y: number } {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  let x = 0;
  let y = 0;
  for (let n = byId.get(id); n; n = n.parent ? byId.get(n.parent) : undefined) {
    x += n.x;
    y += n.y;
  }
  return { x, y };
}
