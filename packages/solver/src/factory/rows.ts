/** LP row building: variable and row names, the Problem shape, `buildLp` and objective terms (§3.1–§3.3). Split from solve.ts (F1); behavior unchanged. */
import type { LpConstraint, LpModel, LpTerm, LpVariable } from '../lp/types';
import {
  IMPORT_SLACK_COST,
  REGULARIZER,
  RESOURCE_SLACK_COST,
  SANITY_CAP,
  SURPLUS_SLACK_COST,
} from './constants';
import type { ImportCost, ObjectiveId } from './types';
import { type Flow, type Model, MW_ITEM_ID, type Recipe, type ResourceNode } from '@sps/data';

export const recipeVar = (id: string) => `recipe:${id}`;
export const importVar = (item: string) => `import:${item}`;
export const surplusVar = (item: string) => `surplus:${item}`;
export const supplyVar = (item: string) => `supply:${item}`;
export const nodeSlackVar = (node: string) => `slack:node:${node}`;
export const importSlackVar = (item: string) => `slack:import:${item}`;
export const resourceSlackVar = (item: string) => `slack:resource:${item}`;
export const surplusSlackVar = (item: string) => `slack:surplus:${item}`;
export const balanceRow = (item: string) => `balance:${item}`;
const nodeRow = (node: string) => `cap:${node}`;
const importRow = (item: string) => `importcap:${item}`;
const resourceRow = (item: string) => `limit:${item}`;
export const machinesVar = (id: string) => `machines:${id}`;
const typeVar = (resource: string) => `type:${resource}`;
export const OUTPUT_VAR = 'output';
const wholeRow = (id: string) => `whole:${id}`;
const typeRow = (resource: string) => `uses:${resource}`;
const typeImportRow = (item: string, resource: string) => `uses:${resource}:import:${item}`;
export const lexRow = (o: ObjectiveId) => `lex:${o}`;

export const byId = <T extends { id: string }>(a: T, b: T) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export const byItem = <T extends { item: string }>(a: T, b: T) =>
  a.item < b.item ? -1 : a.item > b.item ? 1 : 0;

export interface Problem {
  model: Model;
  /** The lexicographic stack; `stack[0]` is the primary objective. */
  stack: ObjectiveId[];
  tolerance: number;
  whole: boolean;
  /** `request.minBranch`, in machines (A34). */
  minBranch: number;
  /** `request.minFlow`, per minute (A68). */
  minFlow: number;
  /** `request.simplicity` (A73). */
  simplicity: boolean;
  /** `request.farmCap` (A86), 0 when off. */
  farmCap: number;
  /** Recipe variables of conversion generators (C1, A73), tidied at CONVERSION_TIDY_WEIGHT. */
  conversion: ReadonlySet<string>;
  /** LP variables held at 0 by the flow prune (A68): recipes (with their machine counts), surpluses, imports. */
  banned: ReadonlySet<string>;
  /** Items only a breeding loop makes (A74); empty unless a wanted item needs one. */
  bred: ReadonlySet<string>;
  recipes: Recipe[];
  /** Balance-row items, sorted. */
  items: string[];
  /** Fixed demand: world demand, plus the targets unless O5 scales them. */
  demand: Map<string, number>;
  /** O5 only: target rates, each scaled by the `output` variable. */
  scaled: Map<string, number>;
  /** Imports with a positive cap, on balance-row items only. */
  importCaps: Map<string, number>;
  /** Caps of the node classes the kept recipes use. */
  nodeCaps: Map<string, number>;
  nodes: Map<string, ResourceNode>;
  /** Raw resource extracted per machine of each kept extraction recipe (A33). */
  extracts: Map<string, { item: string; rate: number }>;
  /** `request.resourceLimits`, on the resources the kept recipes extract. */
  resourceLimits: Map<string, number>;
  /**
   * Miner fluid supplied from outside (A69): per supply item, the fluid it
   * stands for and its cost per m³ under each objective.
   */
  supply: Map<string, { fluid: string; cost: Partial<Record<ObjectiveId, number>> }>;
  /** `avoidFluidByproducts` (A39): balance-row items that may not be left over, sorted. */
  noSurplus: Set<string>;
  /** Per objective: cost per machine of each kept recipe (before the regularizer). */
  costs: Map<ObjectiveId, Map<string, number>>;
  /** O6: node resource → kept recipes drawing on it, and the resource's node cap. */
  resources: Map<string, { recipes: string[]; cap: number }>;
  /** With `costImports`: embodied cost per import item. */
  importCosts: Map<string, ImportCost>;
  /**
   * O4 when not first: conversion generators credited in O4, capped at the
   * machine count the stage before O4 ran them at (set once that stage is solved).
   */
  turbineCaps: Map<string, number>;
  /** O2 weight overrides, for costing objectives outside the stack. */
  scarcityWeights?: Readonly<Record<string, number>>;
  /** `request.marginalCosts`: items and objectives to report marginal costs for. */
  marginal?: { items: string[]; objectives: ObjectiveId[] };
}

/**
 * Factor that brings an objective's largest cost coefficient to 1 (A34).
 * HiGHS's tolerances are absolute, so an objective whose costs are all tiny
 * (O2's usage / map total is about 1e-5 per machine) would leave its
 * optimality and lock rows inside solver noise, and the plan would pick up
 * slivers of other routes. Scaling changes no optimum, only the units the LP
 * works in; stage values and duals stay in natural units.
 */
export function objectiveScale(p: Problem, objective: ObjectiveId): number {
  let max = 0;
  for (const t of objectiveTerms(p, objective)) max = Math.max(max, Math.abs(t.coef));
  return max > 0 ? 1 / max : 1;
}

/** `objectiveTerms`, scaled by `objectiveScale` for the LP (A34). */
export function scaledTerms(
  p: Problem,
  objective: ObjectiveId,
  scale = objectiveScale(p, objective),
): LpTerm[] {
  return objectiveTerms(p, objective).map((t) => ({ ...t, coef: t.coef * scale }));
}

/** An objective as min-form LP terms, without the regularizer (§3.3). */
export function objectiveTerms(p: Problem, objective: ObjectiveId): LpTerm[] {
  if (objective === 'output') return [{ var: OUTPUT_VAR, coef: -1 }];
  if (objective === 'resourceTypes')
    return [...p.resources.keys()].sort().map((r) => ({ var: typeVar(r), coef: 1 }));
  const terms: LpTerm[] = [];
  const cost = p.costs.get(objective)!;
  for (const r of p.recipes) {
    const c = cost.get(r.id) ?? 0;
    if (c === 0) continue;
    // O3 counts built machines: whole ones in whole-machines mode, and
    // always for heaters (A17), which burn full fuel per machine.
    const built = objective === 'machines' && (p.whole || r.heater === true);
    terms.push({ var: built ? machinesVar(r.id) : recipeVar(r.id), coef: c });
  }
  for (const [item, ic] of [...p.importCosts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const c = ic.cost[objective] ?? 0;
    if (c !== 0) terms.push({ var: importVar(item), coef: c });
  }
  for (const [item, { cost }] of p.supply) {
    const c = cost[objective] ?? 0;
    if (c !== 0) terms.push({ var: supplyVar(item), coef: c });
  }
  return terms;
}

/** An objective's value on a solution, in its natural sense (O5 is the scale reached). */
export function stageValue(
  p: Problem,
  objective: ObjectiveId,
  values: Map<string, number>,
): number {
  if (objective === 'output') return Math.max(0, values.get(OUTPUT_VAR) ?? 0);
  if (objective === 'resourceTypes') {
    // Indicators are integral up to the MIP tolerance: count them whole.
    let n = 0;
    for (const r of p.resources.keys()) n += Math.round(values.get(typeVar(r)) ?? 0);
    return n;
  }
  let v = 0;
  for (const t of objectiveTerms(p, objective)) v += t.coef * Math.max(0, values.get(t.var) ?? 0);
  return v;
}

type LpMode = 'normal' | 'elastic' | 'capped';

/**
 * `normal`: the stage LP/MILP with its objective and lexicographic locks.
 * `elastic`: slack on node, resource and import caps, minimizing the relaxation
 * (whole-machine counts and O6 indicators are left out; heater counts stay
 * integer, A17, so the relaxation is what the real plan needs). `capped`: every variable capped at the sanity
 * cap, to name an unbounded direction.
 */
export function buildLp(
  p: Problem,
  mode: LpMode,
  stage: ObjectiveId,
  locks: LpConstraint[] = [],
): LpModel {
  const variables: LpVariable[] = [];
  const objective: LpTerm[] = [];
  const balance = new Map<string, LpTerm[]>(p.items.map((i) => [i, []]));
  const nodeTerms = new Map<string, LpTerm[]>();
  const limitTerms = new Map<string, LpTerm[]>();
  const constraints: LpConstraint[] = [];
  const cap = mode === 'capped' ? SANITY_CAP : Infinity;
  const whole = p.whole && mode !== 'elastic';
  // O6 indicators from its own stage on; earlier stages stay LPs.
  const o6 = p.stack.indexOf('resourceTypes');
  const types = mode !== 'elastic' && o6 >= 0 && o6 <= p.stack.indexOf(stage);

  for (const r of p.recipes) {
    const v = recipeVar(r.id);
    const turbine = mode === 'normal' ? p.turbineCaps.get(r.id) : undefined;
    variables.push({ name: v, lo: 0, hi: turbine ?? cap });
    if (mode !== 'elastic') objective.push({ var: v, coef: REGULARIZER });
    // Heaters (A17) always build whole machines, in every mode: the heater
    // side (fuel, exhaust) scales with the count, the boiler pair with x_j.
    const counted = whole || r.heater === true;
    const scaleOf = (f: Flow) => (f.heater ? machinesVar(r.id) : v);
    for (const f of r.outputs) balance.get(f.item)!.push({ var: scaleOf(f), coef: f.rate });
    for (const f of r.inputs) balance.get(f.item)!.push({ var: scaleOf(f), coef: -f.rate });
    // In whole-machines mode a node is used by a whole machine, even underclocked (R3).
    const user = whole ? machinesVar(r.id) : v;
    if (r.node) nodeTerms.set(r.node, [...(nodeTerms.get(r.node) ?? []), { var: user, coef: 1 }]);
    // A resource limit counts what runs (A33): an underclocked miner extracts less.
    const e = p.extracts.get(r.id);
    if (e && p.resourceLimits.has(e.item))
      limitTerms.set(e.item, [...(limitTerms.get(e.item) ?? []), { var: v, coef: e.rate }]);
    if (counted) {
      variables.push({ name: machinesVar(r.id), lo: 0, hi: cap, integer: true });
      if (mode !== 'elastic') objective.push({ var: machinesVar(r.id), coef: REGULARIZER });
      constraints.push({
        name: wholeRow(r.id),
        terms: [
          { var: v, coef: 1 },
          { var: machinesVar(r.id), coef: -1 },
        ],
        hi: 0,
      });
    }
  }
  if (p.scaled.size) variables.push({ name: OUTPUT_VAR, lo: 0, hi: cap });
  if (mode !== 'elastic') objective.push(...scaledTerms(p, stage));

  for (const [item, cap_i] of p.importCaps) {
    const v = importVar(item);
    if (mode === 'elastic' && Number.isFinite(cap_i)) {
      variables.push({ name: v, lo: 0 });
      variables.push({ name: importSlackVar(item), lo: 0 });
      objective.push({ var: importSlackVar(item), coef: IMPORT_SLACK_COST });
      constraints.push({
        name: importRow(item),
        terms: [
          { var: v, coef: 1 },
          { var: importSlackVar(item), coef: -1 },
        ],
        hi: cap_i,
      });
    } else variables.push({ name: v, lo: 0, hi: Math.min(cap_i, cap) });
    balance.get(item)!.push({ var: v, coef: 1 });
  }
  for (const item of p.supply.keys()) {
    variables.push({ name: supplyVar(item), lo: 0, hi: cap });
    balance.get(item)!.push({ var: supplyVar(item), coef: 1 });
  }
  for (const item of p.items) {
    const v = surplusVar(item);
    // A fluid that may not be left over (A39) gets no surplus; the elastic
    // re-solve prices leaving it over instead, to report how much would be.
    const kept = p.noSurplus.has(item);
    variables.push({ name: v, lo: 0, hi: kept ? 0 : cap });
    balance.get(item)!.push({ var: v, coef: -1 });
    if (kept && mode === 'elastic') {
      variables.push({ name: surplusSlackVar(item), lo: 0 });
      objective.push({ var: surplusSlackVar(item), coef: SURPLUS_SLACK_COST });
      balance.get(item)!.push({ var: surplusSlackVar(item), coef: -1 });
    }
    const ratio = p.scaled.get(item);
    if (ratio) balance.get(item)!.push({ var: OUTPUT_VAR, coef: -ratio });
    const d = p.demand.get(item) ?? 0;
    constraints.push({ name: balanceRow(item), terms: balance.get(item)!, lo: d, hi: d });
  }
  for (const [node, used] of [...nodeTerms].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let terms = used;
    const c = p.nodeCaps.get(node) ?? 0;
    if (!Number.isFinite(c)) continue;
    if (mode === 'elastic') {
      const s = nodeSlackVar(node);
      variables.push({ name: s, lo: 0 });
      objective.push({ var: s, coef: p.nodes.get(node)?.nne ?? 1 });
      terms = [...terms, { var: s, coef: -1 }];
    }
    constraints.push({ name: nodeRow(node), terms, hi: c });
  }
  for (const [item, used] of [...limitTerms].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let terms = used;
    if (mode === 'elastic') {
      const s = resourceSlackVar(item);
      variables.push({ name: s, lo: 0 });
      objective.push({ var: s, coef: RESOURCE_SLACK_COST });
      terms = [...terms, { var: s, coef: -1 }];
    }
    constraints.push({ name: resourceRow(item), terms, hi: p.resourceLimits.get(item)! });
  }
  if (types) {
    // O6 indicators (§3.2): Σ_{j uses r} x_j ≤ cap_r · y_r, and an import
    // brings in the resource types of its standalone plan.
    for (const [resource, { recipes, cap: cap_r }] of [...p.resources].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const y = typeVar(resource);
      variables.push({ name: y, lo: 0, hi: 1, integer: true });
      const big = Number.isFinite(cap_r) ? cap_r : SANITY_CAP;
      constraints.push({
        name: typeRow(resource),
        terms: [...recipes.map((id) => ({ var: recipeVar(id), coef: 1 })), { var: y, coef: -big }],
        hi: 0,
      });
    }
    for (const [item, ic] of [...p.importCosts].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const cap_i = p.importCaps.get(item) ?? 0;
      const big = Number.isFinite(cap_i) ? cap_i : SANITY_CAP;
      for (const resource of ic.resourceTypes) {
        constraints.push({
          name: typeImportRow(item, resource),
          terms: [
            { var: importVar(item), coef: 1 },
            { var: typeVar(resource), coef: -big },
          ],
          hi: 0,
        });
      }
    }
  }
  constraints.push(...locks);
  return {
    sense: 'min',
    objective,
    variables: p.banned.size
      ? variables.map((v) => (p.banned.has(v.name) ? { ...v, lo: 0, hi: 0 } : v))
      : variables,
    constraints,
  };
}

/**
 * A generator that also converts an item, like a turbine turning steam into
 * water or energized slug slime into spent slime: it outputs more than `mw`.
 */
export const isConversionGenerator = (r: Recipe) =>
  r.kind === 'generator' && r.outputs.some((f) => f.item !== MW_ITEM_ID);

/**
 * O2 weight overrides from the model's likely-usage factors (A85): usage /
 * map NNE for each listed resource, the rest left at 1 / map NNE. Undefined
 * when the model lists none, so the request keeps the plain O2 weights.
 */
export function usageWeights(
  model: Pick<Model, 'nodes' | 'scarcityUsage'>,
): Record<string, number> | undefined {
  const usage = Object.entries(model.scarcityUsage ?? {});
  if (!usage.length) return undefined;
  const mapTotal = new Map<string, number>();
  for (const n of model.nodes)
    mapTotal.set(n.resource, (mapTotal.get(n.resource) ?? 0) + n.count * n.nne);
  const weights: Record<string, number> = {};
  for (const [r, u] of usage) {
    const total = mapTotal.get(r) ?? 0;
    if (total > 0) weights[r] = u / total;
  }
  return weights;
}

/** Cost per machine of each recipe under one objective (§3.3); recipes without a cost are left out. */
export function objectiveCosts(
  model: Model,
  objective: ObjectiveId,
  weights: Readonly<Record<string, number>> | undefined,
  recipes: readonly Recipe[],
  nodes: Map<string, ResourceNode>,
  creditTurbines = false,
): Map<string, number> {
  const cost = new Map<string, number>();
  if (objective === 'machines') {
    for (const r of recipes) cost.set(r.id, 1);
    return cost;
  }
  if (objective === 'power') {
    // Machine draw only: generation never lowers it, so O4 has no reason to
    // start otherwise-idle generators. The exception is conversion generators
    // when O4 is not first: their generation is credited, but they are capped
    // at what the earlier stages already run (see `turbineCaps`).
    for (const r of recipes) {
      if (r.powerMW > 0) cost.set(r.id, r.powerMW);
      else if (creditTurbines && r.powerMW < 0 && isConversionGenerator(r))
        cost.set(r.id, r.powerMW);
    }
    return cost;
  }
  if (objective !== 'resources' && objective !== 'scarcity') return cost;
  const mapTotal = new Map<string, number>();
  for (const n of model.nodes)
    mapTotal.set(n.resource, (mapTotal.get(n.resource) ?? 0) + n.count * n.nne);
  for (const r of recipes) {
    const n = r.node ? nodes.get(r.node) : undefined;
    if (!n) continue;
    if (objective === 'resources') cost.set(r.id, n.nne);
    else {
      const total = mapTotal.get(n.resource) ?? 0;
      const w = weights?.[n.resource] ?? (total > 0 ? 1 / total : 1);
      cost.set(r.id, n.nne * w);
    }
  }
  return cost;
}
