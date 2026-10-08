/**
 * Areas of a large factory flowchart (A63): framed groups such as Ore
 * Processing, Steelworks or Final Assembly. Which area an item's recipes
 * belong to is decided at data-build time (data/areas.json); this module
 * places a plan's nodes in areas, applies the factory's own renames and
 * moves, and collapses areas to one box each.
 */
import type { FactoryGraph, FlowEdge, FlowNode, GraphArea } from './factory';

/** The areas the data build defines, in production order. */
export interface AreaCatalog {
  areas: readonly { id: string; name: string; rule?: 'raw' | 'targets' | 'fallback' }[];
  /** The area of an item's recipes; undefined for items without one. */
  itemArea: (item: string) => string | undefined;
}

/** A factory's own area settings (World `Factory.areas`). */
export interface AreaSettings {
  /** "Disable factory component grouping": draw the plan as one flowchart. */
  off?: boolean;
  /** New names, by area id. */
  names?: Readonly<Record<string, string>>;
  /** Nodes moved to another area, by node id. */
  moves?: Readonly<Record<string, string>>;
}

/** Plans with fewer recipe boxes than this stay one flowchart. */
export const AREA_MIN_NODES = 15;

/** A collapsed area's node id. */
export const areaNodeId = (area: string) => `area:${area}`;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Recipe-like boxes: what the size threshold counts. */
const counted = (n: FlowNode) =>
  n.kind === 'recipe' || n.kind === 'resource' || n.kind === 'sub-factory';

/** The node's largest flow among `flows`, ties to the first item. */
const largest = (flows: readonly { item: string; rate: number }[]) =>
  flows.reduce<{ item: string; rate: number } | undefined>(
    (b, f) => (!b || f.rate > b.rate ? f : b),
    undefined,
  )?.item;

/**
 * Each node's default area: recipes by their main product, or Final
 * Assembly when they make one of the plan's targets; sub-factories by their
 * largest output; targets in Final Assembly (with their maker when there is
 * no targets area); imports and missing inputs with
 * their largest consumer; byproducts with their largest producer.
 */
export function defaultAreas(graph: FactoryGraph, catalog: AreaCatalog): Map<string, string> {
  const ids = new Set(catalog.areas.map((a) => a.id));
  const targets = catalog.areas.find((a) => a.rule === 'targets')?.id;
  const fallback = catalog.areas.find((a) => a.rule === 'fallback')?.id ?? catalog.areas[0]?.id;
  const targetIds = new Set(graph.nodes.filter((n) => n.kind === 'target').map((n) => n.id));
  const of = (item: string | undefined) => {
    const a = item !== undefined ? catalog.itemArea(item) : undefined;
    return a !== undefined && ids.has(a) ? a : fallback;
  };
  const at = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.kind === 'recipe' || n.kind === 'resource' || n.kind === 'sub-factory') {
      const makesTarget = graph.edges.some((e) => e.source === n.id && targetIds.has(e.target));
      const area = makesTarget && targets ? targets : of(n.main ?? largest(n.outputs));
      if (area !== undefined) at.set(n.id, area);
    } else if (n.kind === 'target' && targets) at.set(n.id, targets);
  }
  // Ends of the plan sit with what they feed or what feeds them.
  const biggest = (edges: readonly FlowEdge[], end: 'source' | 'target') =>
    [...edges].sort((a, b) => b.rate - a.rate || cmp(a.id, b.id)).find((e) => at.has(e[end]))?.[
      end
    ];
  for (const n of graph.nodes) {
    if (at.has(n.id)) continue;
    const far =
      n.kind === 'byproduct' || n.kind === 'target'
        ? biggest(
            graph.edges.filter((e) => e.target === n.id),
            'source',
          )
        : biggest(
            graph.edges.filter((e) => e.source === n.id),
            'target',
          );
    const area = (far !== undefined ? at.get(far) : undefined) ?? fallback;
    if (area !== undefined) at.set(n.id, area);
  }
  return at;
}

/**
 * The plan grouped into areas (A63), or the plan as it is when grouping is
 * off, the plan has fewer than `AREA_MIN_NODES` recipe boxes, or everything
 * lands in one area. A node moved to an area that no other node is in gets
 * that area too. `collapsed` areas become one box each, with what crosses
 * their border as its inputs and outputs.
 */
export function groupAreas(
  graph: FactoryGraph,
  catalog: AreaCatalog | undefined,
  settings: AreaSettings = {},
  collapsed: ReadonlySet<string> = new Set(),
): FactoryGraph {
  if (!catalog || settings.off || graph.nodes.filter(counted).length < AREA_MIN_NODES) return graph;
  const at = defaultAreas(graph, catalog);
  const known = new Set(catalog.areas.map((a) => a.id));
  for (const [node, area] of Object.entries(settings.moves ?? {}))
    if (at.has(node) && known.has(area)) at.set(node, area);
  const used = new Set(at.values());
  if (used.size < 2) return graph;

  const areas: GraphArea[] = catalog.areas
    .filter((a) => used.has(a.id))
    .map((a) => {
      const inside = graph.nodes.filter((n) => at.get(n.id) === a.id);
      return {
        id: a.id,
        name: settings.names?.[a.id]?.trim() || a.name,
        machines: inside.reduce((s, n) => s + (n.machines ?? 0), 0),
        power: inside.reduce((s, n) => s + (n.power ?? 0), 0),
        ...(collapsed.has(a.id) ? { collapsed: true as const } : {}),
      };
    });
  const nodes = graph.nodes.map((n) => ({ ...n, area: at.get(n.id)! }));
  const grouped: FactoryGraph = { nodes, edges: graph.edges, areas };
  return collapsed.size ? collapse(grouped, areas) : grouped;
}

/** Positive rates merged per item, sorted by item. */
function merge(flows: readonly { item: string; rate: number }[]) {
  const m = new Map<string, number>();
  for (const f of flows) if (f.rate > 0) m.set(f.item, (m.get(f.item) ?? 0) + f.rate);
  return [...m].sort(([a], [b]) => cmp(a, b)).map(([item, rate]) => ({ item, rate }));
}

/** Each collapsed area as one box; lines inside it go, lines across its border end at the box. */
function collapse(graph: FactoryGraph, areas: readonly GraphArea[]): FactoryGraph {
  const shut = new Map(areas.filter((a) => a.collapsed).map((a) => [a.id, a]));
  const box = (n: FlowNode) => (n.area !== undefined && shut.has(n.area) ? n.area : undefined);
  const owner = new Map(graph.nodes.map((n) => [n.id, box(n)]));
  const end = (id: string) => {
    const a = owner.get(id);
    return a !== undefined ? areaNodeId(a) : id;
  };
  const lines = new Map<string, FlowEdge>();
  for (const e of graph.edges) {
    const source = end(e.source);
    const target = end(e.target);
    if (source === target) continue;
    const id = `${source}→${target}:${e.item}`;
    const known = lines.get(id);
    if (known) known.rate += e.rate;
    else lines.set(id, { ...e, id, source, target });
  }
  const edges = [...lines.values()].sort((a, b) => cmp(a.id, b.id));
  const boxes = [...shut.values()].map((a): FlowNode => ({
    id: areaNodeId(a.id),
    kind: 'area',
    label: a.name,
    area: a.id,
    machines: a.machines,
    power: a.power,
    inputs: merge(edges.filter((e) => e.target === areaNodeId(a.id))),
    outputs: merge(edges.filter((e) => e.source === areaNodeId(a.id))),
  }));
  const nodes = [...graph.nodes.filter((n) => box(n) === undefined), ...boxes];
  return { nodes, edges, ...(graph.areas ? { areas: graph.areas } : {}) };
}
