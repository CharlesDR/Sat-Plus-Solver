/**
 * Pure helpers behind the world view's panels (PLAN M8): what each table
 * shows, computed from the world summary and the document, so they can be
 * tested without a browser.
 */
import type { PowerSummary } from '@sps/solver';
import {
  factoryAncestors,
  groupAncestors,
  type LedgerRow,
  type Transport,
  type World,
} from '@sps/world';
import type { Catalog, WorldSummary } from '../solver/protocol';

/** Ledger scopes: the whole save, each group, each factory. */
export type LedgerScope = { kind: 'world' } | { kind: 'group' | 'factory'; id: string };

export const scopeKey = (s: LedgerScope) => (s.kind === 'world' ? 'world' : `${s.kind}:${s.id}`);

export function ledgerScopes(summary: WorldSummary): { scope: LedgerScope; label: string }[] {
  return [
    { scope: { kind: 'world' }, label: 'Whole save' },
    ...summary.groups.map((g) => ({
      scope: { kind: 'group', id: g.id } as LedgerScope,
      label: `Group: ${g.name}`,
    })),
    ...summary.factories.map((f) => ({
      scope: { kind: 'factory', id: f.id } as LedgerScope,
      label: `Factory: ${f.name}`,
    })),
  ];
}

/** The ledger of a scope; empty when the scope no longer exists. */
export function ledgerFor(summary: WorldSummary, scope: LedgerScope): LedgerRow[] {
  if (scope.kind === 'world') return summary.ledger;
  const xs = scope.kind === 'group' ? summary.groups : summary.factories;
  return xs.find((x) => x.id === scope.id)?.ledger ?? [];
}

export interface PowerRow {
  /** `factory:<id>`, `group:<id>` or `total`. */
  key: string;
  label: string;
  power: PowerSummary;
}

/**
 * The power panel: one row per factory, then one per group (each the sum of
 * its factories, §4.5), then the save total, which equals the sum of the
 * factory rows on the single grid (A8).
 */
export function powerRows(summary: WorldSummary): {
  factories: PowerRow[];
  groups: PowerRow[];
  total: PowerRow;
} {
  return {
    factories: summary.factories.map((f) => ({
      key: `factory:${f.id}`,
      label: f.name,
      power: f.power,
    })),
    groups: summary.groups.map((g) => ({ key: `group:${g.id}`, label: g.name, power: g.power })),
    total: { key: 'total', label: 'Whole save', power: summary.power },
  };
}

/**
 * World › outer group › … › parent factories › factory, as names. The groups
 * are the outermost parent's (a sub-factory shows inside its parent, A49);
 * unknown groups are skipped.
 */
export function breadcrumb(
  world: World,
  factoryId: string,
): { groups: string[]; parents: { id: string; name: string }[]; factory: string } {
  const f = world.factories.find((x) => x.id === factoryId);
  if (!f) return { groups: [], parents: [], factory: factoryId };
  const byId = new Map(world.factories.map((x) => [x.id, x]));
  const parents = factoryAncestors(world, factoryId)
    .reverse()
    .map((id) => ({ id, name: byId.get(id)!.name }));
  const top = parents.length ? byId.get(parents[0]!.id)! : f;
  const known = new Map(world.groups.map((g) => [g.id, g.name]));
  const chain =
    top.groupId !== undefined && known.has(top.groupId)
      ? [...groupAncestors(world, top.groupId).reverse(), top.groupId]
      : [];
  return { groups: chain.map((g) => known.get(g)!), parents, factory: f.name };
}

/** The transport tiers a link can pick for a kind, with their capacities. */
export function transportTiers(
  catalog: Pick<Catalog, 'belts' | 'pipes'>,
  kind: Transport,
): { tier: number; perMin: number }[] {
  if (kind === 'belt') return catalog.belts;
  if (kind === 'pipe') return catalog.pipes;
  return [];
}

/**
 * Belts or pipes a rate needs, `ceil(rate / capacity)` (§4.5), as the world
 * layer counts them; `undefined` without a known capacity (train, truck,
 * drone and unspecified are labels only).
 */
export function carriersFor(
  catalog: Pick<Catalog, 'belts' | 'pipes'>,
  transport: { kind: Transport; tier?: number } | undefined,
  rate: number,
): number | undefined {
  if (!transport || transport.tier === undefined) return undefined;
  const capacity = transportTiers(catalog, transport.kind).find(
    (t) => t.tier === transport.tier,
  )?.perMin;
  if (!capacity) return undefined;
  return rate > 0 ? Math.ceil(rate / capacity - 1e-9) : 0;
}

/**
 * Items a link out of `factoryId` would most likely carry: what it makes
 * (produced), most first. Any item may still be typed in.
 */
export function exportsOf(summary: WorldSummary | undefined, factoryId: string): string[] {
  const f = summary?.factories.find((x) => x.id === factoryId);
  if (!f) return [];
  return f.ledger
    .filter((r) => r.produced > 1e-6 && r.item !== 'mw')
    .sort((a, b) => b.produced - a.produced || (a.item < b.item ? -1 : 1))
    .map((r) => r.item);
}

/** Items with any flow in the save, for the item trace picker. */
export function traceableItems(summary: WorldSummary): string[] {
  return summary.ledger.filter((r) => r.item !== 'mw').map((r) => r.item);
}

/** Σ over factories; a check the power panel's total is the factories' sum. */
export function sumPower(rows: readonly PowerRow[]): PowerSummary {
  return rows.reduce(
    (s, r) => ({
      consumptionMW: s.consumptionMW + r.power.consumptionMW,
      generationMW: s.generationMW + r.power.generationMW,
      netMW: s.netMW + r.power.netMW,
    }),
    { consumptionMW: 0, generationMW: 0, netMW: 0 },
  );
}
