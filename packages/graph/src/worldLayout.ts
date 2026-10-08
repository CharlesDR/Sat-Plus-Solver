/**
 * ELK layout of the world graph (PLAN M8), like the factory flowchart's
 * (A25): the engine is injected, sizes are estimated from text, and ELK runs
 * with a fixed seed, so the same graph always gets the same coordinates.
 *
 * Expanded groups are ELK compound nodes laid out with their members. Node
 * positions are relative to the enclosing group (as React Flow's sub-flows
 * expect); edge routes and labels are in root coordinates.
 */
import type { ElkExtendedEdge, ElkLabel, ElkNode, ElkPoint } from 'elkjs/lib/elk-api';
import { CHAR_WIDTH, LINE_HEIGHT, rateText, type Box, type LayoutEngine } from './layout';
import type { WorldEdge, WorldGraph, WorldNode } from './world';

export type PlacedWorldNode = WorldNode & Box;

export interface PlacedWorldEdge extends WorldEdge {
  points: ElkPoint[];
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
/** Lines a stub lists before "… n more". */
const STUB_LINES = 5;

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

const mw = (n: number) => `${rateText(n)} MW`;

/** Power, nodes and machines of a factory or collapsed group, one line each. */
function badges(n: WorldNode): string[] {
  const p = n.power;
  const power = !p
    ? []
    : p.generationMW > 0
      ? [`${mw(p.consumptionMW)} draw · ${mw(p.generationMW)} gen`]
      : [`${mw(p.consumptionMW)} draw`];
  return [...power, `${rateText(n.nodesUsed ?? 0)} nodes · ${rateText(n.machines ?? 0)} machines`];
}

/** The text lines a node shows, which also size it. */
export function worldNodeLines(n: WorldNode): string[] {
  switch (n.kind) {
    case 'factory':
      return [n.label, `Status: ${n.status ?? 'ok'}${n.manual ? ' · Manual' : ''}`, ...badges(n)];
    case 'group':
      if (!n.collapsed) return [n.label];
      if (n.nest)
        return [
          n.label,
          `With ${(n.members ?? 1) - 1} sub-factories · ${n.status ?? 'ok'}`,
          ...badges(n),
        ];
      return [n.label, `Group of ${n.members ?? 0} · ${n.status ?? 'empty'}`, ...badges(n)];
    case 'stub': {
      const items = n.items ?? [];
      const shown = items.slice(0, STUB_LINES).map((i) => `${rateText(i.rate)} ${i.name}`);
      const more = items.length > STUB_LINES ? [`… ${items.length - STUB_LINES} more`] : [];
      return [n.label, ...shown, ...more];
    }
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

export async function layoutWorldGraph(
  graph: WorldGraph,
  engine: LayoutEngine,
): Promise<WorldLayout> {
  const elk = new Map<string, ElkNode>();
  const root: ElkNode = { id: 'root', layoutOptions: ELK_OPTIONS, children: [], edges: [] };
  for (const n of graph.nodes) {
    const frame = n.kind === 'group' && !n.collapsed;
    const lines = worldNodeLines(n);
    const node: ElkNode = frame
      ? { id: n.id, layoutOptions: GROUP_OPTIONS, children: [] }
      : {
          id: n.id,
          width: Math.max(MIN_NODE_WIDTH, textWidth(lines) + 2 * PADDING_X),
          height: lines.length * LINE_HEIGHT + 2 * PADDING_Y + (n.kind === 'stub' ? 0 : ACTION_ROW),
        };
    if (frame) node.width = Math.max(MIN_NODE_WIDTH, textWidth(lines) + 2 * PADDING_X + 80);
    elk.set(n.id, node);
    const parent = n.parent ? elk.get(n.parent) : root;
    (parent ?? root).children!.push(node);
  }
  const lines = new Map(graph.edges.map((e) => [e.id, worldEdgeLines(e)]));
  root.edges = graph.edges.map((e): ElkExtendedEdge => {
    const l = lines.get(e.id)!;
    return {
      id: e.id,
      sources: [e.source],
      targets: [e.target],
      labels: [{ text: l.join('\n'), width: textWidth(l), height: l.length * LINE_HEIGHT }],
    };
  });
  const out = await engine.layout(root);

  const placed = new Map<string, ElkNode>();
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      placed.set(c.id, c);
      walk(c);
    }
  };
  walk(out);
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
        label: { ...box(label), lines: lines.get(e.id)! },
      };
    }),
  };
}

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
