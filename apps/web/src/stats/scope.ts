/**
 * Stats scope (UI-9, A81): which factories, or which recipe group, the plan
 * stats sum over. Pure: the factory view renders what `scopeView` returns.
 */
import type { PowerSummary, SummaryFlow, SummaryRecipe } from '@sps/solver';
import { scopeStats, type FactoryResult, type ScopeSource } from '@sps/world';

export type StatsScope = 'current-below' | 'current' | 'selected-below' | 'selected' | 'world';

export const STATS_SCOPES: readonly { id: StatsScope; label: string }[] = [
  { id: 'current-below', label: 'Current & Below' },
  { id: 'current', label: 'Current Only' },
  { id: 'selected-below', label: 'Selected & Below' },
  { id: 'selected', label: 'Selected Only' },
  { id: 'world', label: 'Full World' },
];

export const isStatsScope = (x: unknown): x is StatsScope => STATS_SCOPES.some((s) => s.id === x);

/** The stats of a scope wider or narrower than the open factory's plan. */
export interface ScopeTotalsView {
  /** What is summed, in words: "3 factories: A, B, C" or "Recipe group: Iron Ingot". */
  label: string;
  targets: SummaryFlow[];
  extraction: SummaryFlow[];
  /** Linked from outside the scope, plus imports nobody supplies. */
  imports: SummaryFlow[];
  /** Linked to factories outside the scope. */
  exports: SummaryFlow[];
  surplus: SummaryFlow[];
  nodes: { node: string; label: string; used: number }[];
  power: PowerSummary;
  /** Whole machines to build. */
  machines: number;
  running: number;
}

export type ScopeView =
  /** The scope is the open factory alone: its own plan shows, as before. */
  | { kind: 'plan' }
  /** A "Selected" scope with nothing summable picked. */
  | { kind: 'pick' }
  | { kind: 'scope'; totals: ScopeTotalsView };

/** The world result as the stats read it. */
export interface ScopeWorld extends ScopeSource {
  factories: readonly (ScopeSource['factories'][number] &
    Pick<FactoryResult, 'name' | 'subtree'>)[];
}

export interface ScopeInput {
  scope: StatsScope;
  factoryId: string;
  /** Undefined until the world first solves: the plan shows. */
  world: ScopeWorld | undefined;
  /** The selected flowchart node id (`recipe:<id>`, `sub:<factory>`, …). */
  selection: string | undefined;
  /** The open factory's recipes, for a selected recipe group. */
  recipes: readonly SummaryRecipe[];
  itemName(id: string): string;
  nodeLabel(id: string): string;
}

/** Flows below this (per minute) are solver noise and are not listed. */
const TOL = 1e-9;

export function scopeView(input: ScopeInput): ScopeView {
  const { scope, factoryId, world, selection } = input;
  if (!world || scope === 'current') return { kind: 'plan' };
  const below = (id: string) =>
    world.factories.find((f) => f.id === id)?.subtree?.factories ?? [id];
  let members: string[];
  if (scope === 'current-below') members = below(factoryId);
  else if (scope === 'world') members = world.factories.map((f) => f.id);
  else if (selection?.startsWith('recipe:')) {
    const id = selection.slice('recipe:'.length);
    const recipe = input.recipes.find((r) => r.id === id);
    return recipe ? { kind: 'scope', totals: recipeTotals(recipe, input) } : { kind: 'pick' };
  } else if (selection?.startsWith('sub:')) {
    const id = selection.slice('sub:'.length);
    if (!world.factories.some((f) => f.id === id)) return { kind: 'pick' };
    members = scope === 'selected-below' ? below(id) : [id];
  } else return { kind: 'pick' };
  if (members.length === 1 && members[0] === factoryId) return { kind: 'plan' };
  return { kind: 'scope', totals: factoryTotals(world, members, input) };
}

function factoryTotals(world: ScopeWorld, members: string[], input: ScopeInput): ScopeTotalsView {
  const s = scopeStats(world, members);
  const flows = (pick: (r: (typeof s.ledger)[number]) => number) =>
    s.ledger.flatMap((r) => {
      const rate = pick(r);
      return rate > TOL ? [flow(r.item, rate, input)] : [];
    });
  const names = s.factories.map((id) => world.factories.find((f) => f.id === id)!.name);
  return {
    label: `${names.length} ${names.length === 1 ? 'factory' : 'factories'}: ${names.join(', ')}`,
    targets: flows((r) => r.target),
    extraction: s.extraction.filter((e) => e.rate > TOL).map((e) => flow(e.item, e.rate, input)),
    imports: flows((r) => r.imported + r.unmet),
    exports: flows((r) => r.exported),
    surplus: flows((r) => r.surplus),
    nodes: s.nodes
      .filter((n) => n.used > TOL)
      .map((n) => ({ node: n.node, label: input.nodeLabel(n.node), used: n.used })),
    power: s.power,
    machines: s.machines,
    running: s.running,
  };
}

/** One recipe group: what goes in is imported, what comes out is exported, net per item. */
function recipeTotals(r: SummaryRecipe, input: ScopeInput): ScopeTotalsView {
  const net = new Map<string, number>();
  for (const f of r.outputs) net.set(f.item, (net.get(f.item) ?? 0) + f.rate);
  for (const f of r.inputs) net.set(f.item, (net.get(f.item) ?? 0) - f.rate);
  const items = [...net].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out = items.filter(([, v]) => v > TOL).map(([item, v]) => flow(item, v, input));
  const extracted = r.node !== undefined;
  return {
    label: `Recipe group: ${r.name}`,
    targets: [],
    extraction: extracted ? out : [],
    imports: items.filter(([, v]) => v < -TOL).map(([item, v]) => flow(item, -v, input)),
    exports: extracted ? [] : out,
    surplus: [],
    nodes:
      r.node !== undefined && r.machines > TOL
        ? [{ node: r.node, label: input.nodeLabel(r.node), used: r.machines }]
        : [],
    power: {
      consumptionMW: Math.max(0, r.powerMW),
      generationMW: Math.max(0, -r.powerMW),
      netMW: r.powerMW,
    },
    machines: r.machinesCeil,
    running: r.machines,
  };
}

const flow = (item: string, rate: number, input: ScopeInput): SummaryFlow => ({
  item,
  name: input.itemName(item),
  rate,
});
