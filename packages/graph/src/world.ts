/**
 * The world graph (docs/ARCHITECTURE.md §4.5 "Outer graph", PLAN M8):
 * factories and groups as nodes, links as edges grouped per pair of shown
 * nodes and labeled by item and rate, and stubs for unmet imports and
 * unclaimed surplus.
 *
 * A collapsed group is one node that stands for every factory below it: the
 * links between two of its factories are internal and hidden, and the links
 * crossing its boundary attach to it. An expanded group is a frame around its
 * members. Item trace marks exactly the factories, collapsed groups, links
 * and stubs that touch the item. Pure and deterministic: everything is sorted
 * by id.
 */
import type { PowerSummary } from '@sps/solver';
import type { FactoryResult, FactoryStatus, GroupResult, LedgerRow, LinkResult } from '@sps/world';

/** The parts of a world result the graph reads. */
export interface WorldGraphInput {
  factories: readonly (Pick<
    FactoryResult,
    'id' | 'name' | 'groupId' | 'status' | 'ledger' | 'power' | 'nodes' | 'machines' | 'manual'
  > &
    Partial<Pick<FactoryResult, 'build'>>)[];
  groups: readonly Pick<
    GroupResult,
    'id' | 'name' | 'parentId' | 'factories' | 'ledger' | 'power' | 'nodes' | 'machines'
  >[];
  links: readonly LinkResult[];
}

export interface WorldGraphOptions {
  /** Ids of the collapsed groups (the `World` document's `Group.collapsed`). */
  collapsed?: Iterable<string>;
  /** Item to trace: every node and edge that touches it gets `traced`. */
  traceItem?: string | undefined;
  /** Item display names; the id is shown where a name is missing. */
  itemName?: (id: string) => string | undefined;
}

export type WorldNodeKind = 'group' | 'factory' | 'stub';

export interface StubItem {
  item: string;
  name: string;
  rate: number;
}

export interface WorldNode {
  /** `group:<id>`, `factory:<id>`, or `stub:in:<node id>` / `stub:out:<node id>`. */
  id: string;
  kind: WorldNodeKind;
  /** The group or factory id; for a stub, the node id it hangs off. */
  ref: string;
  label: string;
  /** Node id of the expanded group drawn around this node. */
  parent?: string;
  /** Groups: collapsed into one node, or a frame around its members. */
  collapsed?: boolean;
  /** Factories and collapsed groups (the worst of its factories). */
  status?: FactoryStatus;
  /** Factories in manual mode (A36). */
  manual?: true;
  /** Factories marked as built (A44): the mark's state. */
  build?: 'matches' | 'note' | 'differs' | 'broken';
  power?: PowerSummary;
  /** Nodes used, summed over node classes. */
  nodesUsed?: number;
  machines?: number;
  /** Groups: how many factories are below it. */
  members?: number;
  /** Stubs: unmet imports (`in`) or unclaimed surplus (`out`), sorted by item. */
  direction?: 'in' | 'out';
  items?: StubItem[];
  traced: boolean;
}

export interface WorldEdgeItem {
  item: string;
  name: string;
  /** Links: the requested rate summed over `links`; stubs: the stub rate. */
  rate: number;
  /** Requested minus delivered: what an upstream failure leaves short. */
  short: number;
  /** Link ids, sorted; empty on a stub edge. */
  links: string[];
}

export interface WorldEdge {
  /** `<source>→<target>`. */
  id: string;
  source: string;
  target: string;
  kind: 'link' | 'stub';
  /** Sorted by item. */
  items: WorldEdgeItem[];
  traced: boolean;
  /** Any of its links is short. */
  short: boolean;
}

export interface WorldGraph {
  /** Groups first (each after its parent), then factories, then stubs; by id within each. */
  nodes: WorldNode[];
  /** Sorted by id. */
  edges: WorldEdge[];
  traceItem?: string;
}

/** Flows below this (per minute) are solver noise: no stub, no trace. */
const FLOW_TOL = 1e-6;
/** Power is its own badge, not a stub. */
const POWER_ITEM = 'mw';

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const SEVERITY: Record<FactoryStatus, number> = { ok: 0, short: 1, infeasible: 2 };

export const groupNodeId = (id: string) => `group:${id}`;
export const factoryNodeId = (id: string) => `factory:${id}`;

const touches = (ledger: readonly LedgerRow[], item: string) =>
  ledger.some(
    (r) =>
      r.item === item &&
      [r.produced, r.consumed, r.target, r.imported, r.exported, r.surplus, r.unmet].some(
        (v) => Math.abs(v) > FLOW_TOL,
      ),
  );

export function worldGraph(input: WorldGraphInput, options: WorldGraphOptions = {}): WorldGraph {
  const collapsed = new Set(options.collapsed ?? []);
  const trace = options.traceItem;
  const name = (id: string) => options.itemName?.(id) ?? id;
  const groups = new Map(input.groups.map((g) => [g.id, g]));
  const parentOf = (g: string) => {
    const p = groups.get(g)?.parentId;
    return p !== undefined && groups.has(p) ? p : undefined;
  };
  /** A group's chain from the top down to itself. */
  const chain = (g: string): string[] => {
    const out = [g];
    for (let p = parentOf(g); p !== undefined && !out.includes(p); p = parentOf(p)) out.unshift(p);
    return out;
  };
  /** Where something inside `g` shows: its outermost collapsed ancestor-or-self, if any. */
  const hiddenBy = (path: readonly string[]) => path.find((g) => collapsed.has(g));
  /** The nearest expanded group around something whose group path is `path`. */
  const frame = (path: readonly string[]) => {
    const p = path.at(-1);
    return p !== undefined ? groupNodeId(p) : undefined;
  };

  const nodes: WorldNode[] = [];
  /** Factory id → the node id it shows as. */
  const shownAs = new Map<string, string>();
  /** Scope node id → its ledger, for stubs. */
  const ledgers = new Map<string, readonly LedgerRow[]>();

  // Groups: a visible group is either collapsed or a frame; parents before children.
  const visibleGroups = [...input.groups]
    .map((g) => ({ g, path: chain(g.id) }))
    .filter(({ path }) => {
      const h = hiddenBy(path.slice(0, -1));
      return h === undefined;
    })
    .sort((a, b) => a.path.length - b.path.length || byKey(a.g.id, b.g.id));
  const statusOf = (ids: readonly string[]) => {
    const fs = input.factories.filter((f) => ids.includes(f.id));
    if (!fs.length) return undefined;
    return fs.map((f) => f.status).reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a));
  };
  for (const { g, path } of visibleGroups) {
    const id = groupNodeId(g.id);
    const isCollapsed = collapsed.has(g.id);
    const parent = frame(path.slice(0, -1));
    const status = isCollapsed ? statusOf(g.factories) : undefined;
    nodes.push({
      id,
      kind: 'group',
      ref: g.id,
      label: g.name,
      ...(parent ? { parent } : {}),
      collapsed: isCollapsed,
      ...(status ? { status } : {}),
      ...(isCollapsed
        ? {
            power: { ...g.power },
            nodesUsed: sumNodes(g.nodes),
            machines: g.machines,
          }
        : {}),
      members: g.factories.length,
      traced: isCollapsed && trace !== undefined && touches(g.ledger, trace),
    });
    if (isCollapsed) ledgers.set(id, g.ledger);
  }

  for (const f of [...input.factories].sort((a, b) => byKey(a.id, b.id))) {
    const path = f.groupId !== undefined && groups.has(f.groupId) ? chain(f.groupId) : [];
    const h = hiddenBy(path);
    if (h !== undefined) {
      shownAs.set(f.id, groupNodeId(h));
      continue;
    }
    const id = factoryNodeId(f.id);
    shownAs.set(f.id, id);
    const parent = frame(path);
    nodes.push({
      id,
      kind: 'factory',
      ref: f.id,
      label: f.name,
      ...(parent ? { parent } : {}),
      status: f.status,
      ...(f.manual ? { manual: true as const } : {}),
      ...(f.build ? { build: f.build.state } : {}),
      power: { ...f.power },
      nodesUsed: sumNodes(f.nodes),
      machines: f.machines,
      traced: trace !== undefined && touches(f.ledger, trace),
    });
    ledgers.set(id, f.ledger);
  }

  // Link edges, one per pair of shown nodes; a link inside one node is hidden.
  const pairs = new Map<string, { source: string; target: string; links: LinkResult[] }>();
  for (const l of input.links) {
    const source = shownAs.get(l.from);
    const target = shownAs.get(l.to);
    if (!source || !target || source === target) continue;
    const id = `${source}→${target}`;
    const pair = pairs.get(id) ?? { source, target, links: [] };
    pair.links.push(l);
    pairs.set(id, pair);
  }
  const edges: WorldEdge[] = [];
  for (const [id, { source, target, links }] of pairs) {
    const byItem = new Map<string, WorldEdgeItem>();
    for (const l of links) {
      const it = byItem.get(l.item) ?? {
        item: l.item,
        name: name(l.item),
        rate: 0,
        short: 0,
        links: [],
      };
      it.rate += l.requested;
      it.short += l.short;
      it.links.push(l.id);
      byItem.set(l.item, it);
    }
    const items = [...byItem.values()].sort((a, b) => byKey(a.item, b.item));
    for (const it of items) it.links.sort(byKey);
    edges.push({
      id,
      source,
      target,
      kind: 'link',
      items,
      traced: trace !== undefined && byItem.has(trace),
      short: items.some((it) => it.short > FLOW_TOL),
    });
  }

  // Stubs: unmet imports in, unclaimed surplus out (§4.5).
  const owners = nodes.filter((n) => ledgers.has(n.id));
  for (const owner of owners) {
    const ledger = ledgers.get(owner.id)!;
    for (const direction of ['in', 'out'] as const) {
      const items = ledger
        .filter((r) => r.item !== POWER_ITEM)
        .map((r) => ({
          item: r.item,
          name: name(r.item),
          rate: direction === 'in' ? r.unmet : r.surplus,
        }))
        .filter((r) => r.rate > FLOW_TOL);
      if (!items.length) continue;
      const id = `stub:${direction}:${owner.id}`;
      const traced = trace !== undefined && items.some((i) => i.item === trace);
      nodes.push({
        id,
        kind: 'stub',
        ref: owner.id,
        label: direction === 'in' ? 'Unmet imports' : 'Unclaimed surplus',
        ...(owner.parent ? { parent: owner.parent } : {}),
        direction,
        items,
        traced,
      });
      const [source, target] = direction === 'in' ? [id, owner.id] : [owner.id, id];
      edges.push({
        id: `${source}→${target}`,
        source,
        target,
        kind: 'stub',
        items: items.map((i) => ({ ...i, short: 0, links: [] })),
        traced,
        short: false,
      });
    }
  }

  const kindOrder: Record<WorldNodeKind, number> = { group: 0, factory: 1, stub: 2 };
  const groupOrder = new Map(nodes.filter((n) => n.kind === 'group').map((n, k) => [n.id, k]));
  nodes.sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      (groupOrder.get(a.id) ?? 0) - (groupOrder.get(b.id) ?? 0) ||
      byKey(a.id, b.id),
  );
  edges.sort((a, b) => byKey(a.id, b.id));
  return { nodes, edges, ...(trace !== undefined ? { traceItem: trace } : {}) };
}

const sumNodes = (uses: readonly { used: number }[]) => uses.reduce((s, u) => s + u.used, 0);
