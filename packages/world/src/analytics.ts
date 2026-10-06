/**
 * World analytics (docs/ARCHITECTURE.md §4.4–4.5): link deliveries, item
 * ledgers, power, node-pool usage and recursive group totals, from the state
 * a resolution pass leaves. Pure.
 */
import type { Model } from '@sps/data';
import type { PowerSummary } from '@sps/solver';
import type { Link, World } from './document';
import type { Pass } from './resolve';
import type {
  FactoryResult,
  FactoryStatus,
  GroupResult,
  LedgerRow,
  LinkResult,
  NodePoolRow,
  NodeUse,
  ScopeTotals,
  WorldDiagnostic,
  WorldResult,
  WorldStats,
} from './types';

/** Flows below this (per minute) are solver noise: a link is not short, a ledger row is empty. */
const FLOW_TOL = 1e-6;

const ZERO_POWER: PowerSummary = { consumptionMW: 0, generationMW: 0, netMW: 0 };
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Row = Omit<LedgerRow, 'item'>;
const emptyRow = (): Row => ({
  produced: 0,
  consumed: 0,
  target: 0,
  imported: 0,
  exported: 0,
  surplus: 0,
  unmet: 0,
});

export function analyze(
  world: World,
  model: Model,
  links: readonly Link[],
  pass: Pass,
  diagnostics: WorldDiagnostic[],
  stats: WorldStats,
  options: { pipeCapacities: Readonly<Record<number, number>> },
): WorldResult {
  const ok = (id: string) => pass.solved.get(id)?.result.status === 'ok';
  const itemName = new Map(model.items.map((i) => [i.id, i.name]));
  const name = (id: string) => itemName.get(id) ?? id;

  // Links: what was asked, shipped and drawn.
  const linkResults: LinkResult[] = links.map((l) => {
    const requested = pass.asked.get(l.id) ?? 0;
    const delivered = pass.delivered.get(l.id) ?? (ok(l.from) ? requested : 0);
    const carriers = carrierCount(model, l, requested, options.pipeCapacities);
    return {
      id: l.id,
      from: l.from,
      to: l.to,
      item: l.item,
      mode: l.mode.kind,
      requested,
      delivered,
      used: pass.used.get(l.id) ?? 0,
      short: requested - delivered,
      ...(l.transport ? { transport: { ...l.transport } } : {}),
      ...(carriers !== undefined ? { carriers } : {}),
    };
  });
  const linkById = new Map(linkResults.map((l) => [l.id, l]));
  for (const l of linkResults)
    if (l.short > FLOW_TOL) {
      const status = pass.solved.get(l.from)?.result.status ?? 'error';
      diagnostics.push({
        code: 'link-short',
        severity: 'warning',
        link: l.id,
        item: l.item,
        deficit: l.short,
        message: pass.solved.get(l.from)?.manual
          ? `Link ${l.id} (${name(l.item)}, ${l.from} → ${l.to}) is short by ${round(l.short)}/min: ${l.from} is in manual mode and makes too little.`
          : `Link ${l.id} (${name(l.item)}, ${l.from} → ${l.to}) is short by ${round(l.short)}/min: ${l.from} is ${status}.`,
      });
    }

  // Per-factory ledgers (each factory is its own scope).
  const factoryRows = new Map<string, Map<string, Row>>();
  const factories: FactoryResult[] = [...world.factories]
    .sort((a, b) => byKey(a.id, b.id))
    .map((f) => {
      const solved = pass.solved.get(f.id)!;
      const { result, request, manual } = solved;
      const manualTarget = new Map(manual?.targets.map((t) => [t.item, t.rate]));
      const rows = new Map<string, Row>();
      const row = (item: string) => {
        let r = rows.get(item);
        if (!r) rows.set(item, (r = emptyRow()));
        return r;
      };
      const incoming = linkResults.filter((l) => l.to === f.id);
      const outgoing = linkResults.filter((l) => l.from === f.id);
      const linkDemand = new Map((request.demand ?? []).map((d) => [d.item, d.rate]));
      if (result.status === 'ok')
        for (const flow of result.items) {
          const r = row(flow.item);
          r.produced = flow.produced;
          r.consumed = flow.consumed;
          r.surplus = flow.surplus;
          r.target = manual
            ? (manualTarget.get(flow.item) ?? 0)
            : Math.max(0, flow.demand - (linkDemand.get(flow.item) ?? 0));
          const viaLinks = incoming
            .filter((l) => l.item === flow.item)
            .reduce((s, l) => s + l.used, 0);
          // Imports no link accounts for came from unassigned imports: unmet in the save.
          r.unmet = Math.max(0, flow.imported - viaLinks);
        }
      for (const l of outgoing) row(l.item).exported += l.delivered;
      for (const l of incoming) {
        const r = row(l.item);
        r.imported += l.delivered;
        // A fixed link ships its rate whatever the consumer draws: the rest is
        // the consumer's available supply. A short link is unmet demand.
        r.surplus += Math.max(0, l.delivered - l.used);
        r.unmet += Math.max(0, l.used - l.delivered);
      }
      factoryRows.set(f.id, rows);
      const short = incoming.some((l) => l.used - l.delivered > FLOW_TOL * Math.max(1, l.used));
      const status: FactoryStatus = result.status !== 'ok' ? 'infeasible' : short ? 'short' : 'ok';
      if (result.status !== 'ok')
        diagnostics.push({
          code: 'factory-failed',
          severity: 'error',
          factory: f.id,
          status: result.status,
          message: `${f.name} (${f.id}) is ${result.status}: ${result.diagnostics.map((d) => d.message).join(' ') || 'no plan.'}`,
        });
      if (manual) {
        const want = new Map(request.targets.map((t) => [t.item, 0]));
        for (const t of request.targets) want.set(t.item, want.get(t.item)! + t.rate);
        const short = [...want]
          .map(([item, rate]) => ({ item, rate: rate - (manualTarget.get(item) ?? 0) }))
          .filter((t) => t.rate > FLOW_TOL)
          .sort((a, b) => byKey(a.item, b.item));
        if (manual.missing.length || short.length)
          diagnostics.push({
            code: 'manual-short',
            severity: 'warning',
            factory: f.id,
            missing: manual.missing.map((m) => ({ ...m })),
            targets: short,
            message:
              `${f.name} (${f.id}) is in manual mode and unbalanced:` +
              [
                ...manual.missing.map((m) => ` needs ${round(m.rate)}/min more ${name(m.item)}`),
                ...short.map((t) => ` makes ${round(t.rate)}/min too little ${name(t.item)}`),
              ].join(';') +
              '.',
          });
      }
      return {
        id: f.id,
        name: f.name,
        ...(f.groupId !== undefined ? { groupId: f.groupId } : {}),
        ...(manual
          ? {
              manual: {
                missing: manual.missing.map((m) => ({ ...m })),
                targets: manual.targets.map((t) => ({ ...t })),
              },
            }
          : {}),
        status,
        request,
        key: solved.key,
        result,
        ledger: toLedger(rows),
        power: result.status === 'ok' ? { ...result.power } : { ...ZERO_POWER },
        nodes:
          result.status === 'ok' ? result.nodes.map((n) => ({ node: n.node, used: n.used })) : [],
        extraction:
          result.status === 'ok'
            ? result.extraction.map((e) => ({ item: e.item, rate: e.rate }))
            : [],
        machines:
          result.status === 'ok' ? result.recipes.reduce((s, r) => s + r.machinesCeil, 0) : 0,
      };
    });
  const factoryById = new Map(factories.map((f) => [f.id, f]));

  /** Totals of a set of factories; links with one end outside are its boundary. */
  const scope = (members: ReadonlySet<string>): ScopeTotals => {
    const rows = new Map<string, Row>();
    const add = (item: string, r: Partial<Row>) => {
      const t = rows.get(item) ?? emptyRow();
      for (const k of Object.keys(r) as (keyof Row)[]) t[k] += r[k]!;
      rows.set(item, t);
    };
    for (const id of [...members].sort()) {
      for (const [item, r] of factoryRows.get(id)!)
        add(item, {
          produced: r.produced,
          consumed: r.consumed,
          target: r.target,
          surplus: r.surplus,
          unmet: r.unmet,
        });
    }
    for (const l of linkResults) {
      const from = members.has(l.from);
      const to = members.has(l.to);
      if (from && !to) add(l.item, { exported: l.delivered });
      if (to && !from) add(l.item, { imported: l.delivered });
    }
    const fs = [...members].sort().map((id) => factoryById.get(id)!);
    return {
      ledger: toLedger(rows),
      power: sumPower(fs.map((f) => f.power)),
      nodes: sumNodes(fs.flatMap((f) => f.nodes)),
      machines: fs.reduce((s, f) => s + f.machines, 0),
    };
  };

  const groups = resolveGroups(world, diagnostics).map(({ group, factories: members }) => {
    const set = new Set(members);
    const internalLinks: string[] = [];
    const boundaryLinks: string[] = [];
    for (const l of linkResults) {
      const a = set.has(l.from);
      const b = set.has(l.to);
      if (a && b) internalLinks.push(l.id);
      else if (a || b) boundaryLinks.push(l.id);
    }
    const result: GroupResult = {
      id: group.id,
      name: group.name,
      ...(group.parentId !== undefined ? { parentId: group.parentId } : {}),
      factories: members,
      internalLinks,
      boundaryLinks,
      ...scope(set),
    };
    return result;
  });

  // Node pool (§4.4): usage across factories vs the map pool, flagged, not enforced (A9).
  const nodePool: NodePoolRow[] = [...model.nodes]
    .sort((a, b) => byKey(a.id, b.id))
    .map((n) => {
      const byFactory = factories
        .flatMap((f) =>
          f.nodes.filter((u) => u.node === n.id).map((u) => ({ factory: f.id, used: u.used })),
        )
        .filter((u) => u.used > 0);
      const used = byFactory.reduce((s, u) => s + u.used, 0);
      const pool = world.nodePool[n.id] ?? n.count;
      const overAllocated = used > pool + FLOW_TOL * Math.max(1, pool);
      if (overAllocated)
        diagnostics.push({
          code: 'node-over-allocated',
          severity: 'warning',
          node: n.id,
          used,
          pool,
          message: `${name(n.resource)} (${n.purity}) nodes are over-allocated: ${round(used)} used of ${round(pool)} on the map, by ${byFactory.map((u) => u.factory).join(', ')}.`,
        });
      return {
        node: n.id,
        resource: n.resource,
        purity: n.purity,
        pool,
        used,
        byFactory,
        overAllocated,
      };
    });

  const all = scope(new Set(factories.map((f) => f.id)));
  return {
    factories,
    links: linkResults.map((l) => linkById.get(l.id)!),
    groups,
    ledger: all.ledger,
    power: { ...all.power, deficitMW: Math.max(0, all.power.netMW) },
    nodes: all.nodes,
    machines: all.machines,
    nodePool,
    diagnostics: sortDiagnostics(diagnostics),
    stats,
  };
}

function toLedger(rows: ReadonlyMap<string, Row>): LedgerRow[] {
  return [...rows]
    .filter(([, r]) => Object.values(r).some((v) => Math.abs(v) > 1e-12))
    .sort(([a], [b]) => byKey(a, b))
    .map(([item, r]) => ({ item, ...r }));
}

function sumPower(ps: readonly PowerSummary[]): PowerSummary {
  const consumptionMW = ps.reduce((s, p) => s + p.consumptionMW, 0);
  const generationMW = ps.reduce((s, p) => s + p.generationMW, 0);
  return { consumptionMW, generationMW, netMW: consumptionMW - generationMW };
}

function sumNodes(uses: readonly NodeUse[]): NodeUse[] {
  const m = new Map<string, number>();
  for (const u of uses) m.set(u.node, (m.get(u.node) ?? 0) + u.used);
  return [...m].sort(([a], [b]) => byKey(a, b)).map(([node, used]) => ({ node, used }));
}

/** Belts or pipes for a link, when its transport tier has a known capacity (§4.5, A10). */
function carrierCount(
  model: Model,
  link: Link,
  rate: number,
  pipes: Readonly<Record<number, number>>,
): number | undefined {
  const t = link.transport;
  if (!t || t.tier === undefined) return undefined;
  const capacity =
    t.kind === 'belt'
      ? model.beltCapacities.find((b) => b.tier === t.tier)?.perMin
      : t.kind === 'pipe'
        ? pipes[t.tier]
        : undefined;
  if (!capacity || capacity <= 0) return undefined;
  return rate > 0 ? Math.ceil(rate / capacity - 1e-9) : 0;
}

/**
 * Groups with their descendant factories, sorted by id. A group whose parent
 * is unknown or part of a parent cycle is treated as a root; a factory in an
 * unknown group as ungrouped. Both are reported.
 */
function resolveGroups(
  world: World,
  diagnostics: WorldDiagnostic[],
): { group: World['groups'][number]; factories: string[] }[] {
  const groups = [...world.groups].sort((a, b) => byKey(a.id, b.id));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const parent = new Map<string, string>();
  for (const g of groups) {
    if (g.parentId === undefined) continue;
    if (!byId.has(g.parentId)) {
      diagnostics.push({
        code: 'invalid-group',
        severity: 'warning',
        group: g.id,
        message: `Group ${g.id} has an unknown parent ${g.parentId}; it is shown at the top level.`,
      });
      continue;
    }
    parent.set(g.id, g.parentId);
  }
  // Break parent cycles at their smallest id.
  for (const g of groups) {
    const seen: string[] = [];
    let at: string | undefined = g.id;
    while (at !== undefined && !seen.includes(at)) {
      seen.push(at);
      at = parent.get(at);
    }
    if (at !== undefined) {
      const cycle = seen.slice(seen.indexOf(at)).sort();
      parent.delete(cycle[0]!);
      diagnostics.push({
        code: 'invalid-group',
        severity: 'warning',
        group: cycle[0]!,
        message: `Groups ${cycle.join(', ')} are nested in a cycle; ${cycle[0]} is shown at the top level.`,
      });
    }
  }
  const direct = new Map<string, string[]>();
  for (const f of world.factories) {
    if (f.groupId === undefined) continue;
    if (!byId.has(f.groupId)) {
      diagnostics.push({
        code: 'invalid-group',
        severity: 'warning',
        group: f.groupId,
        factory: f.id,
        message: `Factory ${f.id} is in an unknown group ${f.groupId}; it is shown ungrouped.`,
      });
      continue;
    }
    direct.set(f.groupId, [...(direct.get(f.groupId) ?? []), f.id]);
  }
  const children = new Map<string, string[]>();
  for (const [child, p] of parent) children.set(p, [...(children.get(p) ?? []), child]);
  const descendants = (id: string): string[] => [
    ...(direct.get(id) ?? []),
    ...(children.get(id) ?? []).flatMap(descendants),
  ];
  return groups.map((g) => {
    const p = parent.get(g.id);
    const rest = { ...g };
    delete rest.parentId;
    return {
      group: p !== undefined ? { ...rest, parentId: p } : rest,
      factories: [...new Set(descendants(g.id))].sort(),
    };
  });
}

const ORDER: Record<WorldDiagnostic['code'], number> = {
  'invalid-link': 0,
  'invalid-group': 1,
  'factory-failed': 2,
  'cycle-not-converged': 3,
  'link-short': 4,
  'node-over-allocated': 5,
  'import-cost-unsettled': 6,
  'manual-short': 7,
};

function sortDiagnostics(ds: WorldDiagnostic[]): WorldDiagnostic[] {
  return [...ds].sort((a, b) => ORDER[a.code] - ORDER[b.code] || byKey(a.message, b.message));
}

const round = (n: number) => String(Math.round(n * 1000) / 1000);
