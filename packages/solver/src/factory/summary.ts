/**
 * Display-ready plan summary: the rows of the plan table shared by the CLI
 * (`pnpm solve`) and the web summary table, so both show the same numbers.
 * Names are resolved against the model; numbers stay numeric (use `formatRate` or `formatExact`).
 */
import type { Model } from '@sps/data';
import { formatExact, formatQuiet, formatRate, groupThousands } from './numbers';
import type { Diagnostic, ObjectiveId, PowerSummary, SolveResult, SolveStatus } from './types';

export interface SummaryRecipe {
  id: string;
  name: string;
  /** Machine display name. */
  machine: string;
  machines: number;
  machinesCeil: number;
  powerMW: number;
  /** Heaters only (A17): boiler load 0–1; `machines` is then the whole heater count. */
  boilerLoad?: number;
  /** What these machines consume and produce per minute (the plan's own flows), without MW. */
  inputs: SummaryFlow[];
  outputs: SummaryFlow[];
  /** Extraction recipes: the node class they draw on. */
  node?: string;
}

export interface SummaryFlow {
  item: string;
  name: string;
  rate: number;
  /** Targets on a virtual item (A84): the part, by name, whose rate `rate` is. */
  per?: string;
}

/** One item's movement in the plan (the Items tab, UX-4). */
export interface SummaryItem {
  item: string;
  name: string;
  produced: number;
  consumed: number;
  imported: number;
  surplus: number;
  /** Targets plus world demand. */
  demand: number;
}

export interface SummaryNode {
  node: string;
  /** "Resource (purity)". */
  label: string;
  /** Share of the node pool (DF-1, A98), checked against `budget`. */
  used: number;
  /** Nodes the miners sit on, one per machine (DF-1). */
  occupied: number;
  budget: number;
  nne: number;
}

export interface PlanSummary {
  status: SolveStatus;
  objective: ObjectiveId;
  objectiveValue?: number;
  /** Structured, so the web app can offer fixes (M10). */
  diagnostics: Diagnostic[];
  recipes: SummaryRecipe[];
  /** Targets plus world demand, per item. */
  targets: SummaryFlow[];
  imports: SummaryFlow[];
  /** Surplus and byproducts. */
  byproducts: SummaryFlow[];
  /** Every item that moves except MW, sorted by name (UX-4). */
  items: SummaryItem[];
  nodes: SummaryNode[];
  /** Raw resources extracted (A33). */
  extraction: SummaryFlow[];
  power: PowerSummary;
  /** Loop items the plan needs a starter of (A74), by name. Absent when none. */
  starters?: string[];
}

/** The power pseudo-item: generators output it; the MW column and Power line show it. */
const MW = 'mw';

export function summarizePlan(model: Model, result: SolveResult): PlanSummary {
  const item = new Map(model.items.map((i) => [i.id, i.name]));
  const machine = new Map(model.machines.map((m) => [m.id, m.name]));
  const node = new Map(model.nodes.map((n) => [n.id, n]));
  const name = (id: string) => item.get(id) ?? id;
  const flow = (id: string, rate: number): SummaryFlow => ({ item: id, name: name(id), rate });
  const per = new Map(model.items.flatMap((i) => (i.per ? [[i.id, name(i.per)] as const] : [])));
  const target = (id: string, rate: number): SummaryFlow => {
    const p = per.get(id);
    return { ...flow(id, rate), ...(p ? { per: p } : {}) };
  };
  return {
    status: result.status,
    objective: result.objective,
    ...(result.objectiveValue !== undefined ? { objectiveValue: result.objectiveValue } : {}),
    diagnostics: [...result.diagnostics],
    recipes: result.recipes.map((r) => ({
      id: r.id,
      name: r.name,
      machine: machine.get(r.machine) ?? r.machine,
      machines: r.machines,
      machinesCeil: r.machinesCeil,
      powerMW: r.powerMW,
      ...(r.boilerLoad !== undefined ? { boilerLoad: r.boilerLoad } : {}),
      inputs: r.inputs.filter((f) => f.item !== MW).map((f) => flow(f.item, f.rate)),
      outputs: r.outputs.filter((f) => f.item !== MW).map((f) => flow(f.item, f.rate)),
      ...(r.node !== undefined ? { node: r.node } : {}),
    })),
    targets: result.items.filter((i) => i.demand > 0).map((i) => target(i.item, i.demand)),
    imports: result.imports.map((r) => flow(r.item, r.rate)),
    byproducts: result.surplus.map((r) => flow(r.item, r.rate)),
    items: result.items
      .filter((i) => i.item !== MW)
      .map((i) => ({
        item: i.item,
        name: name(i.item),
        produced: i.produced,
        consumed: i.consumed,
        imported: i.imported,
        surplus: i.surplus,
        demand: i.demand,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || (a.item < b.item ? -1 : 1)),
    nodes: result.nodes.map((n) => {
      const meta = node.get(n.node);
      return {
        node: n.node,
        label: meta ? `${name(meta.resource)} (${meta.purity})` : n.node,
        used: n.used,
        occupied: n.occupied,
        budget: n.budget,
        nne: n.nne,
      };
    }),
    extraction: result.extraction.map((e) => flow(e.item, e.rate)),
    power: { ...result.power },
    ...(result.starters?.length ? { starters: result.starters.map(name) } : {}),
  };
}

/** The plan note for its starters (A74), such as "Needs starter Lime Slugs." No count is given. */
export function starterNote(plan: Pick<PlanSummary, 'starters'>): string | undefined {
  const names = (plan.starters ?? []).map((n) => (n.endsWith('s') ? n : `${n}s`));
  if (!names.length) return undefined;
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Needs starter ${list}.`;
}

/** How a table writes its numbers: rates and counts, and the same with an exact fraction. */
export interface NumberFormat {
  rate(n: number): string;
  exact(n: number): string;
}

/** The A41 format the CLI uses: 1 to 4 decimals, with the exact fraction. */
export const PRECISE_NUMBERS: NumberFormat = { rate: formatRate, exact: formatExact };
/** The quiet format (UX-6, A78): 1 to 2 decimals and "<0.01"; the web app's default. */
export const QUIET_NUMBERS: NumberFormat = { rate: formatQuiet, exact: formatQuiet };

/** A recipe's inputs or outputs as one cell: "Iron Ore 30.0, Coal 15.0" (UX-4). */
const flowsText = (flows: readonly SummaryFlow[], rate: (n: number) => string) =>
  flows.map((f) => `${f.name} ${rate(f.rate)}`).join(', ');

/**
 * The Recipes table of the plan, as text cells (CLI and web share it). A
 * `Boiler` column (load %, A17) appears only when the plan builds a heater:
 * its Count is whole heaters, which burn full fuel; the boiler side runs at
 * the load shown. With `io`, Inputs and Outputs columns follow the machine
 * (UX-4). Rows keep the order of `plan.recipes`.
 */
export function recipeTable(
  plan: Pick<PlanSummary, 'recipes'>,
  options: { io?: boolean; format?: NumberFormat } = {},
): { head: string[]; rows: string[][] } {
  const { io = false, format = PRECISE_NUMBERS } = options;
  const heaters = plan.recipes.some((r) => r.boilerLoad !== undefined);
  return {
    head: [
      'Recipe',
      'Machine',
      ...(io ? ['Inputs', 'Outputs'] : []),
      'Count',
      'Build',
      ...(heaters ? ['Boiler'] : []),
      'MW',
    ],
    rows: plan.recipes.map((r) => [
      r.name,
      r.machine,
      ...(io ? [flowsText(r.inputs, format.rate), flowsText(r.outputs, format.rate)] : []),
      format.exact(r.machines),
      groupThousands(String(r.machinesCeil)),
      ...(heaters ? [r.boilerLoad === undefined ? '' : `${format.rate(r.boilerLoad * 100)}%`] : []),
      format.rate(r.powerMW),
    ]),
  };
}
