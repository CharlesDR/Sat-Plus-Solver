/**
 * Display-ready plan summary: the rows of the plan table shared by the CLI
 * (`pnpm solve`) and the web summary table, so both show the same numbers.
 * Names are resolved against the model; numbers stay numeric (use `formatRate`).
 */
import type { Model } from '@sps/data';
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
}

export interface SummaryFlow {
  item: string;
  name: string;
  rate: number;
}

export interface SummaryNode {
  node: string;
  /** "Resource (purity)". */
  label: string;
  used: number;
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
  nodes: SummaryNode[];
  power: PowerSummary;
}

export function summarizePlan(model: Model, result: SolveResult): PlanSummary {
  const item = new Map(model.items.map((i) => [i.id, i.name]));
  const machine = new Map(model.machines.map((m) => [m.id, m.name]));
  const node = new Map(model.nodes.map((n) => [n.id, n]));
  const name = (id: string) => item.get(id) ?? id;
  const flow = (id: string, rate: number): SummaryFlow => ({ item: id, name: name(id), rate });
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
    })),
    targets: result.items.filter((i) => i.demand > 0).map((i) => flow(i.item, i.demand)),
    imports: result.imports.map((r) => flow(r.item, r.rate)),
    byproducts: result.surplus.map((r) => flow(r.item, r.rate)),
    nodes: result.nodes.map((n) => {
      const meta = node.get(n.node);
      return {
        node: n.node,
        label: meta ? `${name(meta.resource)} (${meta.purity})` : n.node,
        used: n.used,
        budget: n.budget,
        nne: n.nne,
      };
    }),
    power: { ...result.power },
  };
}

/**
 * The Recipes table of the plan, as text cells (CLI and web share it). A
 * `Boiler` column (load %, A17) appears only when the plan builds a heater:
 * its Count is whole heaters, which burn full fuel; the boiler side runs at
 * the load shown.
 */
export function recipeTable(plan: PlanSummary): { head: string[]; rows: string[][] } {
  const heaters = plan.recipes.some((r) => r.boilerLoad !== undefined);
  return {
    head: ['Recipe', 'Machine', 'Count', 'Build', ...(heaters ? ['Boiler'] : []), 'MW'],
    rows: plan.recipes.map((r) => [
      r.name,
      r.machine,
      formatRate(r.machines),
      String(r.machinesCeil),
      ...(heaters ? [r.boilerLoad === undefined ? '' : `${formatRate(r.boilerLoad * 100)}%`] : []),
      formatRate(r.powerMW),
    ]),
  };
}

/** Number format of the plan table: 3 decimals, 3 significant digits below 0.001. */
export function formatRate(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n !== 0 && Math.abs(n) < 0.001) return n.toPrecision(3);
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}
