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
  /** Machine id. */
  machineId: string;
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

/** An item amount, such as a building's cost (TI-1). */
export interface SummaryAmount {
  item: string;
  name: string;
  amount: number;
}

/** One building type the plan places (TI-1): the Machines tab row. */
export interface SummaryBuilding {
  /** Machine id. */
  machine: string;
  name: string;
  /** Buildings to place: Σ `machinesCeil` of its recipe groups. */
  count: number;
  /** With a build mark: buildings to add, Σ max(0, now − built) over its recipe groups. */
  expand?: number;
  /** What one building costs, sorted by item id; empty when the data has none. */
  cost: SummaryAmount[];
}

/** One item of the materials to build (TI-1). */
export interface SummaryMaterial extends SummaryAmount {
  /** With a build mark: what the buildings to add take. */
  expand?: number;
}

/** What a plan takes to build (TI-1): buildings by name, then materials by name. */
export interface BuildBill {
  buildings: SummaryBuilding[];
  materials: SummaryMaterial[];
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
  /** Buildings and materials to build (TI-1). */
  bill: BuildBill;
}

/** The power pseudo-item: generators output it; the MW column and Power line show it. */
const MW = 'mw';

/**
 * `built`: with a build mark, whole buildings per recipe group as built
 * (A44), for the bill's To expand counts (TI-1).
 */
export function summarizePlan(
  model: Model,
  result: SolveResult,
  built?: ReadonlyMap<string, number>,
): PlanSummary {
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
      machineId: r.machine,
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
    bill: buildBill(
      model,
      result.recipes.map((r) => ({ machine: r.machine, count: r.machinesCeil, recipe: r.id })),
      built,
    ),
  };
}

/** Whole buildings for `machines` running machines, as a plan's Build column counts them. */
export const wholeBuildings = (machines: number) => Math.ceil(machines - 1e-6);

/**
 * What some recipe groups take to build (TI-1): one row per building, with
 * its cost per building from the model, and the materials summed. With
 * `built` (recipe → whole buildings as built), each building also gets its
 * To expand count, max(0, now − built) per recipe group: a group the plan no
 * longer runs frees nothing toward another.
 */
export function buildBill(
  model: Pick<Model, 'machines' | 'items'>,
  groups: readonly { machine: string; count: number; recipe?: string }[],
  built?: ReadonlyMap<string, number>,
): BuildBill {
  const item = new Map(model.items.map((i) => [i.id, i.name]));
  const machines = new Map(model.machines.map((m) => [m.id, m]));
  const rows = new Map<string, SummaryBuilding>();
  for (const g of groups) {
    if (g.count <= 0) continue;
    let row = rows.get(g.machine);
    if (!row) {
      const m = machines.get(g.machine);
      row = {
        machine: g.machine,
        name: m?.name ?? g.machine,
        count: 0,
        ...(built ? { expand: 0 } : {}),
        cost: (m?.buildCost ?? []).map((c) => ({
          item: c.item,
          name: item.get(c.item) ?? c.item,
          amount: c.amount,
        })),
      };
      rows.set(g.machine, row);
    }
    row.count += g.count;
    if (built && row.expand !== undefined)
      row.expand += Math.max(
        0,
        g.count - (g.recipe === undefined ? 0 : (built.get(g.recipe) ?? 0)),
      );
  }
  return mergeBills([...rows.values()]);
}

/**
 * Building rows summed per machine (several factories' bills, A81), with the
 * materials they take. A To expand count shows when any row has one.
 */
export function mergeBills(rows: readonly SummaryBuilding[]): BuildBill {
  const expands = rows.some((r) => r.expand !== undefined);
  const byMachine = new Map<string, SummaryBuilding>();
  for (const r of rows) {
    const t = byMachine.get(r.machine);
    if (!t) byMachine.set(r.machine, { ...r, ...(expands ? { expand: r.expand ?? 0 } : {}) });
    else {
      t.count += r.count;
      if (expands) t.expand = (t.expand ?? 0) + (r.expand ?? 0);
    }
  }
  const buildings = [...byMachine.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || (a.machine < b.machine ? -1 : 1),
  );
  const materials = new Map<string, SummaryMaterial>();
  for (const b of buildings)
    for (const c of b.cost) {
      const m = materials.get(c.item) ?? {
        item: c.item,
        name: c.name,
        amount: 0,
        ...(expands ? { expand: 0 } : {}),
      };
      m.amount += c.amount * b.count;
      if (expands) m.expand = (m.expand ?? 0) + c.amount * (b.expand ?? 0);
      materials.set(c.item, m);
    }
  return {
    buildings,
    materials: [...materials.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || (a.item < b.item ? -1 : 1),
    ),
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

/** The Machines table of a bill (TI-1), as text cells: CLI and web share it. */
export function buildingTable(bill: BuildBill): { head: string[]; rows: string[][] } {
  const expands = bill.buildings.some((b) => b.expand !== undefined);
  return {
    head: ['Machine', 'Build', ...(expands ? ['To expand'] : [])],
    rows: bill.buildings.map((b) => [
      b.name,
      groupThousands(String(b.count)),
      // Nothing to add shows blank, so the additions stand out (TI-1).
      ...(expands ? [b.expand ? groupThousands(String(b.expand)) : ''] : []),
    ]),
  };
}

/** The Materials to build table of a bill (TI-1), as text cells. */
export function materialTable(
  bill: BuildBill,
  format: NumberFormat = PRECISE_NUMBERS,
): { head: string[]; rows: string[][] } {
  const expands = bill.materials.some((m) => m.expand !== undefined);
  // Parts come whole: a whole amount shows no decimals.
  const amount = (n: number) => (Number.isInteger(n) ? groupThousands(String(n)) : format.exact(n));
  return {
    head: ['Item', 'Amount', ...(expands ? ['To expand'] : [])],
    rows: bill.materials.map((m) => [
      m.name,
      amount(m.amount),
      ...(expands ? [m.expand ? amount(m.expand) : ''] : []),
    ]),
  };
}
