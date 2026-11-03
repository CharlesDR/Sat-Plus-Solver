/**
 * Areas of a large factory flowchart (A63): framed groups. By default they
 * come from the plan's pinch points (A87, pinch.ts); "Group by: part type"
 * uses the part types decided at data-build time (data/areas.json), such as
 * Ore Processing or Steelworks. This module places a plan's nodes in areas,
 * applies the factory's own renames and moves, counts the parts crossing
 * each border, and collapses areas to one box each.
 */
import type { FactoryGraph, FlowEdge, FlowNode, GraphArea } from './factory';
import { allocate } from './factory';
import { bandAreas, metalRanks, oreBand } from './band';
import { productLines } from './lines';
import { areaFlows, isBox, pinchAreas } from './pinch';

/** The areas the data build defines, in production order. */
export interface AreaCatalog {
  areas: readonly { id: string; name: string; rule?: 'raw' | 'targets' | 'fallback' }[];
  /** The area of an item's recipes; undefined for items without one. */
  itemArea: (item: string) => string | undefined;
  /** Liquids and gases: their extraction is not ore processing, and is drawn where it is used (A107). */
  isFluid?: (item: string) => boolean;
}

/** A factory's own area settings (World `Factory.areas`). */
export interface AreaSettings {
  /** "Disable factory component grouping": draw the plan as one flowchart. */
  off?: boolean;
  /**
   * How boxes are grouped (A87): `pinch` (the default) builds areas from the
   * plan's pinch points, `parts` from the catalog's part types (A63).
   */
  by?: 'pinch' | 'parts';
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
const counted = isBox;

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
function defaultAreas(graph: FactoryGraph, catalog: AreaCatalog): Map<string, string> {
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
  return placeEnds(graph, at, fallback);
}

/**
 * Ends of the plan (imports, missing inputs, targets, byproducts) not yet in
 * an area sit with their largest consumer or producer.
 */
function placeEnds(
  graph: FactoryGraph,
  at: Map<string, string>,
  fallback: string | undefined,
): Map<string, string> {
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
  if (settings.off || graph.nodes.filter(counted).length < AREA_MIN_NODES) return graph;
  const pinch = settings.by !== 'parts';
  if (!pinch && !catalog) return graph;
  let at: Map<string, string>;
  let list: readonly { id: string; name: string }[];
  let rankOf: Map<string, number> | undefined;
  let band: ReadonlyMap<string, boolean> | undefined;
  const isFluid = catalog?.isFluid ?? (() => false);
  if (pinch) {
    // The ore band first (A107), then product lines or pinch points group the rest.
    const raw = catalog?.areas.find((a) => a.rule === 'raw')?.id;
    band =
      raw === undefined ? undefined : oreBand(graph, (i) => catalog!.itemArea(i) === raw, isFluid);
    const b = band ? bandAreas(graph, band) : { at: new Map<string, string>(), areas: [] };
    // Fresh fluid extraction is drawn with the areas it feeds (localFluids).
    const fresh = band ? graph.nodes.filter((n) => isFresh(n, isFluid)).map((n) => n.id) : [];
    const apart = new Set([...b.at.keys(), ...fresh]);
    const lines = band ? productLines(graph, apart) : undefined;
    const p = lines ?? pinchAreas(graph, apart);
    list = [...b.areas, ...p.areas];
    at = placeEnds(graph, new Map([...b.at, ...p.at]), list[0]?.id);
    if (lines) {
      rankOf = lines.rank;
      for (const a of b.areas) rankOf.set(a.id, lines.middle);
    }
  } else {
    at = defaultAreas(graph, catalog!);
    list = catalog!.areas;
  }
  const known = new Set(list.map((a) => a.id));
  // A move of one fresh-fluid piece moves its whole box, which then stays whole.
  const moved = new Set<string>();
  for (const [node, area] of Object.entries(settings.moves ?? {})) {
    const id = baseNodeId(node);
    if (at.has(id) && known.has(area)) {
      at.set(id, area);
      moved.add(id);
    }
  }
  const used = new Set(at.values());
  if (used.size < 2) return graph;

  graph = localFluids(graph, at, isFluid, moved);
  graph = reallocate(graph, at, list);
  if (band && !rankOf) rankOf = metalRanks(graph, at, list);
  const boxes = new Set(graph.nodes.filter(counted).map((n) => n.id));
  const flows = areaFlows(graph.edges, at, boxes);
  const areas: GraphArea[] = list
    .filter((a) => used.has(a.id))
    .map((a) => {
      const inside = graph.nodes.filter((n) => at.get(n.id) === a.id);
      return {
        id: a.id,
        name: settings.names?.[a.id]?.trim() || a.name,
        machines: inside.reduce((s, n) => s + (n.machines ?? 0), 0),
        power: inside.reduce((s, n) => s + (n.power ?? 0), 0),
        ins: flows.get(a.id)?.ins.size ?? 0,
        outs: flows.get(a.id)?.outs.size ?? 0,
        ...(collapsed.has(a.id) ? { collapsed: true as const } : {}),
        ...(rankOf?.has(a.id) ? { rank: rankOf.get(a.id)! } : {}),
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

/** Separator of a fresh-fluid piece's id from its box's id (A107). */
export const PIECE = '@';

/** The box a node id belongs to: itself, or the box a fresh-fluid piece was cut from. */
export const baseNodeId = (id: string) => {
  const k = id.indexOf(PIECE);
  return k < 0 ? id : id.slice(0, k);
};

/** Fresh fluid extraction: a box making a fluid from nothing but power (water extractors, wells). */
function isFresh(n: FlowNode, isFluid: (item: string) => boolean): boolean {
  return (
    (n.kind === 'resource' || n.kind === 'recipe') &&
    n.main !== undefined &&
    isFluid(n.main) &&
    n.inputs.every((f) => f.item === 'mw')
  );
}

/**
 * Rule 2 (A107): fresh fluid extraction is drawn in each area it feeds, as
 * one piece per area with that area's share of the machines, power and
 * flows, so water does not run in long lines from one place. The pieces'
 * ids are the box's id, `PIECE` and the area. A box the user moved stays whole.
 */
function localFluids(
  graph: FactoryGraph,
  at: Map<string, string>,
  isFluid: (item: string) => boolean,
  moved: ReadonlySet<string>,
): FactoryGraph {
  const nodes: FlowNode[] = [];
  for (const n of graph.nodes) {
    const share = new Map<string, number>();
    if (isFresh(n, isFluid) && !moved.has(n.id))
      for (const e of graph.edges)
        if (e.source === n.id) {
          const area = at.get(e.target) ?? '';
          share.set(area, (share.get(area) ?? 0) + e.rate);
        }
    const total = [...share.values()].reduce((a, b) => a + b, 0);
    if (share.size < 2 || !(total > 0)) {
      nodes.push(n);
      continue;
    }
    for (const [area, rate] of [...share].sort(([a], [b]) => cmp(a, b))) {
      const f = rate / total;
      const id = `${n.id}${PIECE}${area}`;
      at.set(id, area);
      nodes.push({
        ...n,
        id,
        ...(n.machines !== undefined ? { machines: n.machines * f } : {}),
        ...(n.power !== undefined ? { power: n.power * f } : {}),
        inputs: n.inputs.map((x) => ({ ...x, rate: x.rate * f })),
        outputs: n.outputs.map((x) => ({ ...x, rate: x.rate * f })),
      });
    }
    at.delete(n.id);
  }
  return { ...graph, nodes };
}

/**
 * Rule 2 (A107): each item's supply is split over its consumers in area
 * order, then node order, so the earliest producers feed the earliest
 * consumers and a byproduct runs back only when no later area takes it.
 * The plan is unchanged; only which producer feeds which consumer is.
 */
function reallocate(
  graph: FactoryGraph,
  at: ReadonlyMap<string, string>,
  list: readonly { id: string }[],
): FactoryGraph {
  const order = new Map(list.map((a, k) => [a.id, k]));
  const place = new Map(graph.nodes.map((n, k) => [n.id, k]));
  const rank = (id: string) => order.get(at.get(id) ?? '') ?? list.length;
  const byArea = (a: { node: string }, b: { node: string }) =>
    rank(a.node) - rank(b.node) || place.get(a.node)! - place.get(b.node)!;
  const supply = new Map<string, { node: string; rate: number }[]>();
  const take = new Map<string, { node: string; rate: number }[]>();
  const push = (m: typeof supply, item: string, node: string, rate: number) => {
    const list = m.get(item);
    if (list) list.push({ node, rate });
    else m.set(item, [{ node, rate }]);
  };
  for (const n of graph.nodes) {
    for (const f of n.outputs) push(supply, f.item, n.id, f.rate);
    for (const f of n.inputs) push(take, f.item, n.id, f.rate);
  }
  const name = new Map(graph.edges.map((e) => [e.item, e.itemName]));
  const edges: FlowEdge[] = [];
  for (const [item, producers] of supply) {
    const consumers = take.get(item);
    if (!consumers) continue;
    for (const { source, target, rate } of allocate(producers.sort(byArea), consumers.sort(byArea)))
      edges.push({
        id: `${source}→${target}:${item}`,
        source,
        target,
        item,
        itemName: name.get(item) ?? item,
        rate,
      });
  }
  edges.sort((a, b) => cmp(a.id, b.id));
  return { ...graph, edges };
}
