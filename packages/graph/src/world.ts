/**
 * The world graph (docs/ARCHITECTURE.md §4.5 "Outer graph", PLAN M8):
 * factories and groups as nodes, links as edges grouped per pair of shown
 * nodes and labeled by item and rate.
 *
 * A collapsed group is one node that stands for every factory below it: the
 * links between two of its factories are internal and hidden, and the links
 * crossing its boundary attach to it. Each card has one port per part it takes
 * or ships (A80): unmet imports are red input ports, and surplus that is
 * neither a target nor an export folds into one "…" output port. An expanded group is a frame around its
 * members. A factory with sub-factories (A53) is drawn the same way: a frame
 * around it and everything below it, or, collapsed, one node with only the
 * flows crossing its subtree. Item trace marks exactly the factories, collapsed groups and links
 * that touch the item. Pure and deterministic: everything is sorted
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
    Partial<
      Pick<
        FactoryResult,
        'build' | 'parentId' | 'subtree' | 'subtreeBuild' | 'extraction' | 'targets'
      >
    >)[];
  groups: readonly Pick<
    GroupResult,
    'id' | 'name' | 'parentId' | 'factories' | 'ledger' | 'power' | 'nodes' | 'machines'
  >[];
  links: readonly LinkResult[];
}

export interface WorldGraphOptions {
  /** Ids of the collapsed groups (the `World` document's `Group.collapsed`). */
  collapsed?: Iterable<string>;
  /** Ids of the collapsed factories with sub-factories (`Factory.collapsed`, A53). */
  collapsedFactories?: Iterable<string>;
  /** Item to trace: every node and edge that touches it gets `traced`. */
  traceItem?: string | undefined;
  /** Item display names; the id is shown where a name is missing. */
  itemName?: (id: string) => string | undefined;
}

export type WorldNodeKind = 'group' | 'factory';

export interface CardItem {
  item: string;
  name: string;
  rate: number;
}

/** One part on a card's edge (A80). */
export interface WorldPort extends CardItem {
  /**
   * Inputs: imported plus unmet; outputs: target plus exported, per minute.
   */
  rate: number;
  /** Inputs: what no link or import brings. Drawn red with a dangling stub. */
  unmet?: number;
  /** Outputs: made beyond what is targeted or shipped, plus For links left spare (A92). */
  surplus?: number;
  /** A link edge carries it. */
  linked: boolean;
  /** Outputs: which band of the card's side it sits in, top to bottom (DF-3). */
  band?: OutBand;
}

/**
 * The bands of a card's output side, top to bottom (DF-3): parts for links
 * (For links targets and exports), then byproducts (surplus that is no
 * target, so it can be dragged to a link), then Kept-only targets.
 */
export const OUT_BANDS = ['links', 'byproduct', 'kept'] as const;
export type OutBand = (typeof OUT_BANDS)[number];

/** Output ports a card shows before the rest fold into its "+N" port. */
export const MAX_OUT_PORTS = 8;

export interface WorldNode {
  /**
   * `group:<id>`, `nest:<factory id>` (a factory with sub-factories, A53),
   * or `factory:<id>`.
   */
  id: string;
  kind: WorldNodeKind;
  /** The group or factory id. */
  ref: string;
  /** A group node that stands for a factory and its sub-factories (A53); `ref` is the factory. */
  nest?: true;
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
  /** Factories and collapsed groups: raw resources extracted, summed per minute. */
  rawExtracted?: number;
  machines?: number;
  /** Groups: how many factories are below it (a nest counts its factory too). */
  members?: number;
  /** Factories and collapsed groups: input ports, by part name (A80). */
  inPorts?: WorldPort[];
  /** Factories and collapsed groups: output ports, by band, then by part name (DF-3). */
  outPorts?: WorldPort[];
  /**
   * The "…" port: the outputs folded past `MAX_OUT_PORTS` (Kept-only
   * targets fold first, then byproducts, then unlinked parts for links),
   * listed in band order.
   */
  more?: (CardItem & { kind: 'surplus' | 'product' })[];
  /** Factories: raw resources the plan extracts, shown while the card is selected. */
  raw?: CardItem[];
  traced: boolean;
}

export interface WorldEdgeItem {
  item: string;
  name: string;
  /** The requested rate summed over `links`. */
  rate: number;
  /** Requested minus delivered: what an upstream failure leaves short. */
  short: number;
  /** Link ids, sorted. */
  links: string[];
}

export interface WorldEdge {
  /** `<source>→<target>`. */
  id: string;
  source: string;
  target: string;
  kind: 'link';
  /** Sorted by item. */
  items: WorldEdgeItem[];
  traced: boolean;
  /** Any of its links is short. */
  short: boolean;
}

export interface WorldGraph {
  /** Groups first (each after its parent), then factories; by id within each. */
  nodes: WorldNode[];
  /** Sorted by id. */
  edges: WorldEdge[];
  traceItem?: string;
}

/** Flows below this (per minute) are solver noise: no port, no trace. */
const FLOW_TOL = 1e-6;
/** Power is its own badge, not a port. */
const POWER_ITEM = 'mw';

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const SEVERITY: Record<FactoryStatus, number> = { empty: 0, ok: 1, short: 2, infeasible: 3 };

export const groupNodeId = (id: string) => `group:${id}`;
export const factoryNodeId = (id: string) => `factory:${id}`;
export const nestNodeId = (id: string) => `nest:${id}`;

const touches = (ledger: readonly LedgerRow[], item: string) =>
  ledger.some(
    (r) =>
      r.item === item &&
      [r.produced, r.consumed, r.target, r.imported, r.exported, r.surplus, r.unmet].some(
        (v) => Math.abs(v) > FLOW_TOL,
      ),
  );

export function worldGraph(input: WorldGraphInput, options: WorldGraphOptions = {}): WorldGraph {
  const collapsed = new Set([
    ...[...(options.collapsed ?? [])].map(groupNodeId),
    ...[...(options.collapsedFactories ?? [])].map(nestNodeId),
  ]);
  const trace = options.traceItem;
  const name = (id: string) => options.itemName?.(id) ?? id;
  const groups = new Map(input.groups.map((g) => [g.id, g]));
  const factoryById = new Map(input.factories.map((f) => [f.id, f]));
  const nested = (f: (typeof input.factories)[number]) =>
    f.parentId !== undefined && factoryById.has(f.parentId) ? f.parentId : undefined;
  /** Factories with sub-factories: each is a nest (A53). */
  const nests = new Set(
    input.factories.flatMap((f) => {
      const p = nested(f);
      return p !== undefined ? [p] : [];
    }),
  );
  /** The container node id something sits in directly: a group frame or a nest. */
  const containerOfFactory = (id: string): string | undefined => {
    const f = factoryById.get(id);
    if (!f) return undefined;
    const p = nested(f);
    if (p !== undefined) return nestNodeId(p);
    return f.groupId !== undefined && groups.has(f.groupId) ? groupNodeId(f.groupId) : undefined;
  };
  const containerOf = (node: string): string | undefined => {
    if (node.startsWith('nest:')) return containerOfFactory(node.slice('nest:'.length));
    const g = node.slice('group:'.length);
    const p = groups.get(g)?.parentId;
    return p !== undefined && groups.has(p) ? groupNodeId(p) : undefined;
  };
  /** A container's chain from the top down to itself. */
  const chain = (c: string): string[] => {
    const out = [c];
    for (let p = containerOf(c); p !== undefined && !out.includes(p); p = containerOf(p))
      out.unshift(p);
    return out;
  };
  /** Where something inside the path shows: its outermost collapsed container, if any. */
  const hiddenBy = (path: readonly string[]) => path.find((c) => collapsed.has(c));
  /** The nearest expanded container around something whose container path is `path`. */
  const frame = (path: readonly string[]) => path.at(-1);

  const nodes: WorldNode[] = [];
  /** Factory id → the node id it shows as. */
  const shownAs = new Map<string, string>();
  /** Scope node id → its ledger, for ports. */
  const ledgers = new Map<string, readonly LedgerRow[]>();
  /**
   * Per shown node, per item: For links its links leave spare (A92), shown
   * as spare beside surplus. A manual factory's spare is already its surplus.
   */
  const spares = new Map<string, Map<string, number>>();
  const spareOf = (ids: readonly string[]) => {
    const m = new Map<string, number>();
    for (const f of input.factories)
      if (ids.includes(f.id) && !f.manual)
        for (const t of f.targets ?? []) m.set(t.item, (m.get(t.item) ?? 0) + t.spare);
    return m;
  };
  /** Per shown node: targets no member wants any of For links, only Kept (DF-3). */
  const keptOnly = new Map<string, Set<string>>();
  const keptOnlyOf = (ids: readonly string[]) => {
    const forLinks = new Map<string, number>();
    for (const f of input.factories)
      if (ids.includes(f.id))
        for (const t of f.targets ?? [])
          forLinks.set(t.item, (forLinks.get(t.item) ?? 0) + t.forLinks);
    return new Set([...forLinks].filter(([, rate]) => rate <= FLOW_TOL).map(([item]) => item));
  };

  /** Raw resources the factories extract, summed per minute (items and m³ alike). */
  const extracted = (ids: readonly string[]) => {
    const rate = input.factories
      .filter((f) => ids.includes(f.id))
      .flatMap((f) => f.extraction ?? [])
      .reduce((s, r) => s + (r.rate > FLOW_TOL ? r.rate : 0), 0);
    return rate > 0 ? { rawExtracted: rate } : {};
  };
  const statusOf = (ids: readonly string[]) => {
    const fs = input.factories.filter((f) => ids.includes(f.id));
    if (!fs.length) return undefined;
    return fs.map((f) => f.status).reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a));
  };
  // Containers: a visible one is either collapsed or a frame; parents before children.
  const containers = [...input.groups.map((g) => groupNodeId(g.id)), ...[...nests].map(nestNodeId)]
    .map((id) => ({ id, path: chain(id) }))
    .filter(({ path }) => hiddenBy(path.slice(0, -1)) === undefined)
    .sort((a, b) => a.path.length - b.path.length || byKey(a.id, b.id));
  for (const { id, path } of containers) {
    const isCollapsed = collapsed.has(id);
    const parent = frame(path.slice(0, -1));
    const isNest = id.startsWith('nest:');
    const ref = id.slice(id.indexOf(':') + 1);
    const f = isNest ? factoryById.get(ref)! : undefined;
    const g = isNest ? undefined : groups.get(ref)!;
    const totals = f
      ? (f.subtree ?? { ledger: f.ledger, power: f.power, nodes: f.nodes, machines: f.machines })
      : g!;
    const members = f ? (f.subtree?.factories ?? [f.id]) : g!.factories;
    const status = isCollapsed ? statusOf(members) : undefined;
    nodes.push({
      id,
      kind: 'group',
      ref,
      ...(isNest ? { nest: true as const } : {}),
      label: f ? f.name : g!.name,
      ...(parent ? { parent } : {}),
      collapsed: isCollapsed,
      ...(status ? { status } : {}),
      ...(isCollapsed && f?.subtreeBuild ? { build: f.subtreeBuild } : {}),
      ...(isCollapsed
        ? {
            power: { ...totals.power },
            nodesUsed: sumNodes(totals.nodes),
            ...extracted(members),
            machines: totals.machines,
          }
        : {}),
      members: members.length,
      traced: isCollapsed && trace !== undefined && touches(totals.ledger, trace),
    });
    if (isCollapsed) {
      ledgers.set(id, totals.ledger);
      spares.set(id, spareOf(members));
      keptOnly.set(id, keptOnlyOf(members));
    }
  }

  for (const f of [...input.factories].sort((a, b) => byKey(a.id, b.id))) {
    const own = nests.has(f.id) ? nestNodeId(f.id) : containerOfFactory(f.id);
    const path = own !== undefined ? chain(own) : [];
    const h = hiddenBy(path);
    if (h !== undefined) {
      shownAs.set(f.id, h);
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
      ...extracted([f.id]),
      machines: f.machines,
      ...(f.extraction?.length
        ? {
            raw: f.extraction
              .filter((r) => r.rate > FLOW_TOL)
              .map((r) => ({ item: r.item, name: name(r.item), rate: r.rate })),
          }
        : {}),
      traced: trace !== undefined && touches(f.ledger, trace),
    });
    ledgers.set(id, f.ledger);
    spares.set(id, spareOf([f.id]));
    keptOnly.set(id, keptOnlyOf([f.id]));
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

  // Ports (A80): what each card takes and ships, plus any part a link carries.
  const linkedIn = new Map<string, Map<string, number>>();
  const linkedOut = new Map<string, Map<string, number>>();
  const add = (m: Map<string, Map<string, number>>, node: string, item: string, rate: number) => {
    const byItem = m.get(node) ?? new Map<string, number>();
    byItem.set(item, (byItem.get(item) ?? 0) + rate);
    m.set(node, byItem);
  };
  for (const e of edges)
    for (const it of e.items) {
      add(linkedOut, e.source, it.item, it.rate);
      add(linkedIn, e.target, it.item, it.rate);
    }
  const byName = (a: CardItem, b: CardItem) => byKey(a.name, b.name) || byKey(a.item, b.item);
  for (const n of nodes) {
    const ledger = ledgers.get(n.id);
    if (!ledger) continue;
    const rows = new Map(ledger.filter((r) => r.item !== POWER_ITEM).map((r) => [r.item, r]));
    const ins = linkedIn.get(n.id) ?? new Map<string, number>();
    const outs = linkedOut.get(n.id) ?? new Map<string, number>();
    const inItems = new Set([
      ...[...rows.values()]
        .filter((r) => r.imported > FLOW_TOL || r.unmet > FLOW_TOL)
        .map((r) => r.item),
      ...ins.keys(),
    ]);
    n.inPorts = [...inItems]
      .map((item): WorldPort => {
        const r = rows.get(item);
        const unmet = r?.unmet ?? 0;
        return {
          item,
          name: name(item),
          rate: r ? r.imported + r.unmet : ins.get(item)!,
          ...(unmet > FLOW_TOL ? { unmet } : {}),
          linked: ins.has(item),
        };
      })
      .sort(byName);
    // Outputs in three bands (DF-3): parts for links, byproducts, Kept-only targets.
    const kept = keptOnly.get(n.id) ?? new Set<string>();
    const bandOf = (item: string): OutBand | undefined => {
      const r = rows.get(item);
      if (outs.has(item) || (r?.exported ?? 0) > FLOW_TOL) return 'links';
      if ((r?.target ?? 0) > FLOW_TOL) return kept.has(item) ? 'kept' : 'links';
      if ((r?.surplus ?? 0) > FLOW_TOL) return 'byproduct';
      return undefined;
    };
    const outItems = new Set([...rows.keys(), ...outs.keys()]);
    const outPorts = [...outItems]
      .flatMap((item): WorldPort[] => {
        const band = bandOf(item);
        if (!band) return [];
        const r = rows.get(item);
        const surplus = (r?.surplus ?? 0) + (spares.get(n.id)?.get(item) ?? 0);
        return [
          {
            item,
            name: name(item),
            rate: r ? r.target + r.exported : outs.get(item)!,
            ...(surplus > FLOW_TOL ? { surplus } : {}),
            linked: outs.has(item),
            band,
          },
        ];
      })
      .sort((a, b) => OUT_BANDS.indexOf(a.band!) - OUT_BANDS.indexOf(b.band!) || byName(a, b));
    // Past the cap, Kept-only targets fold into the "…" port first, then
    // byproducts, then unlinked parts for links; linked ones always show.
    let fold = outPorts.length > MAX_OUT_PORTS ? outPorts.length - (MAX_OUT_PORTS - 1) : 0;
    const folded = new Set<WorldPort>();
    for (const band of [...OUT_BANDS].reverse())
      for (const p of outPorts.filter((q) => q.band === band && !q.linked).reverse())
        if (fold > 0) {
          folded.add(p);
          fold--;
        }
    n.outPorts = outPorts.filter((p) => !folded.has(p));
    const more: NonNullable<WorldNode['more']> = outPorts
      .filter((p) => folded.has(p))
      .map((p) =>
        p.band === 'byproduct'
          ? { item: p.item, name: p.name, rate: p.surplus ?? 0, kind: 'surplus' as const }
          : { item: p.item, name: p.name, rate: p.rate, kind: 'product' as const },
      );
    if (more.length) n.more = more;
  }

  const kindOrder: Record<WorldNodeKind, number> = { group: 0, factory: 1 };
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
