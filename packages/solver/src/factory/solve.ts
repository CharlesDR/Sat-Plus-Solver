import type { Model, Recipe, ResourceNode } from '@sps/data';
import type {
  LpBackend,
  LpConstraint,
  LpModel,
  LpOptions,
  LpSolution,
  LpTerm,
  LpVariable,
} from '../lp/types';
import { closestFixes, producible, prune } from './reachability';
import { OBJECTIVE_IDS } from './types';
import type {
  Diagnostic,
  ImportCost,
  ItemFlow,
  ItemRate,
  NodeUsage,
  ObjectiveId,
  Relaxation,
  RecipeUsage,
  SolveRequest,
  SolveResult,
  SolveStats,
  StageResult,
} from './types';

/** Tie-break weight on Σx (§3.3): picks a stable plan among equal-cost ones. */
const REGULARIZER = 1e-9;
/** Sanity cap used to name the direction of an unbounded LP (§3.5). */
const SANITY_CAP = 1e7;
/** Elastic re-solve: cost of 1/min of extra import, in normal-node-equivalents. */
const IMPORT_SLACK_COST = 0.01;
/** Solution checks (CLAUDE.md): balance within 1e-6, variables ≥ −1e-9, nodes ≤ budget. */
const BALANCE_TOL = 1e-6;
const NONNEG_TOL = 1e-9;
/** Smallest positive target or demand rate, per minute: anything below is under the LP's precision. */
export const MIN_RATE = 1e-6;
/** Lexicographic tolerance range and default (§3.3), as fractions: 0.01%–90%, default 0.01%. */
export const MIN_TOLERANCE = 1e-4;
export const MAX_TOLERANCE = 0.9;
export const DEFAULT_TOLERANCE = MIN_TOLERANCE;
/** Absolute floor ε of the lexicographic constraint, so an optimum of 0 still gets some room. */
export const LEX_EPSILON = 1e-6;
/** Default of `RecipeFilter.alternates`: standard recipes only (alternates are opt-in). */
export const DEFAULT_ALTERNATES = false;
/** Default time limit of a MILP stage, in seconds (§3.4). */
export const MILP_TIME_LIMIT_SECONDS = 5;
/** Elastic slack below this is solver noise, not a relaxation. */
const SLACK_TOL = 1e-9;

const recipeVar = (id: string) => `recipe:${id}`;
const importVar = (item: string) => `import:${item}`;
const surplusVar = (item: string) => `surplus:${item}`;
const nodeSlackVar = (node: string) => `slack:node:${node}`;
const importSlackVar = (item: string) => `slack:import:${item}`;
const balanceRow = (item: string) => `balance:${item}`;
const nodeRow = (node: string) => `cap:${node}`;
const importRow = (item: string) => `importcap:${item}`;
const machinesVar = (id: string) => `machines:${id}`;
const typeVar = (resource: string) => `type:${resource}`;
const OUTPUT_VAR = 'output';
const wholeRow = (id: string) => `whole:${id}`;
const typeRow = (resource: string) => `uses:${resource}`;
const typeImportRow = (item: string, resource: string) => `uses:${resource}:import:${item}`;
const lexRow = (o: ObjectiveId) => `lex:${o}`;

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byItem = <T extends { item: string }>(a: T, b: T) =>
  a.item < b.item ? -1 : a.item > b.item ? 1 : 0;

interface Problem {
  model: Model;
  /** The lexicographic stack; `stack[0]` is the primary objective. */
  stack: ObjectiveId[];
  tolerance: number;
  whole: boolean;
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
  /** Per objective: cost per machine of each kept recipe (before the regularizer). */
  costs: Map<ObjectiveId, Map<string, number>>;
  /** O6: node resource → kept recipes drawing on it, and the resource's node cap. */
  resources: Map<string, { recipes: string[]; cap: number }>;
  /** With `costImports`: embodied cost per import item. */
  importCosts: Map<string, ImportCost>;
}

/** Clamps a tolerance input to [MIN_TOLERANCE, MAX_TOLERANCE] (for UI controls); NaN gives the default. */
export function clampTolerance(tolerance: number): number {
  if (Number.isNaN(tolerance)) return DEFAULT_TOLERANCE;
  return Math.min(MAX_TOLERANCE, Math.max(MIN_TOLERANCE, tolerance));
}

/** The request's objective stack: `objectives`, else `[objective]`, else `['resources']`. */
export function objectiveStack(request: SolveRequest): ObjectiveId[] {
  return [...(request.objectives ?? [request.objective ?? 'resources'])];
}

/**
 * Solves one factory (docs/ARCHITECTURE.md §3): filters and prunes recipes,
 * builds the LP or MILP (item balance, node capacity, imports, surplus, whole
 * machines, resource-type indicators), solves the objective stack
 * lexicographically, handles every backend status with the §3.5 diagnostics,
 * and checks the plan before returning it. Deterministic: identical input
 * gives identical output.
 */
export async function solve(
  model: Model,
  request: SolveRequest,
  backend: LpBackend,
  options: LpOptions = {},
): Promise<SolveResult> {
  const stack = objectiveStack(request);
  const invalid = validate(model, request, stack);
  if (invalid) return failed('error', stack, [invalid]);
  const scales = stack[0] === 'output';

  // Fixed demand per item: world demand, plus targets unless O5 scales them.
  const demand = new Map<string, number>();
  const scaled = new Map<string, number>();
  for (const d of request.targets)
    if (d.rate > 0) {
      const into = scales ? scaled : demand;
      into.set(d.item, (into.get(d.item) ?? 0) + d.rate);
    }
  for (const d of request.demand ?? [])
    if (d.rate > 0) demand.set(d.item, (demand.get(d.item) ?? 0) + d.rate);
  const wanted = [...new Set([...demand.keys(), ...scaled.keys()])];

  const importCaps = new Map<string, number>();
  for (const i of request.imports ?? [])
    if (i.cap > 0) importCaps.set(i.item, (importCaps.get(i.item) ?? 0) + i.cap);

  // Recipe filter, then reachability (§3.5) and pruning.
  const exclude = new Set(request.recipes?.exclude ?? []);
  const alternates = request.recipes?.alternates ?? DEFAULT_ALTERNATES;
  const enabled: Recipe[] = [];
  const disabled: Recipe[] = [];
  for (const r of [...model.recipes].sort(byId))
    (exclude.has(r.id) || (!alternates && r.alternate) ? disabled : enabled).push(r);
  const sources = [...importCaps.keys()].sort();
  const available = producible(enabled, sources);
  const unreachable = wanted.filter((i) => !available.has(i)).sort();
  const names = new Map(model.items.map((i) => [i.id, i.name]));
  const itemName = (id: string) => names.get(id) ?? id;
  if (unreachable.length) {
    return failed(
      'unreachable',
      stack,
      unreachable.map((item) => {
        const fixes = closestFixes(item, enabled, disabled, sources);
        return {
          code: 'unreachable',
          severity: 'error',
          item,
          message:
            `Nothing can produce ${itemName(item)}.` +
            (fixes.length
              ? ` Enabling one of these recipes would fix it: ${fixes.join(', ')}.`
              : ' No recipe in the dataset can make it from here; add an import.'),
          fixes,
        };
      }),
    );
  }
  const recipes = prune(enabled, available, wanted);

  // Items, node caps and objective costs.
  const itemSet = new Set(wanted);
  for (const r of recipes) for (const f of [...r.inputs, ...r.outputs]) itemSet.add(f.item);
  const items = [...itemSet].sort();
  for (const item of [...importCaps.keys()]) if (!itemSet.has(item)) importCaps.delete(item);

  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const budget = request.nodeBudget ?? 'pool';
  const nodeCaps = new Map<string, number>();
  for (const r of recipes) {
    if (!r.node || nodeCaps.has(r.node)) continue;
    nodeCaps.set(
      r.node,
      budget === 'pool' ? (nodes.get(r.node)?.count ?? 0) : (budget[r.node] ?? 0),
    );
  }
  const costs = new Map(
    stack.map((o) => [o, objectiveCosts(model, o, request.scarcityWeights, recipes, nodes)]),
  );
  const resources = new Map<string, { recipes: string[]; cap: number }>();
  if (stack.includes('resourceTypes')) {
    const capped = new Set<string>();
    for (const r of recipes) {
      const n = r.node ? nodes.get(r.node) : undefined;
      if (!n) continue;
      const entry = resources.get(n.resource) ?? { recipes: [], cap: 0 };
      entry.recipes.push(r.id);
      if (!capped.has(n.id)) {
        capped.add(n.id);
        entry.cap += nodeCaps.get(n.id) ?? 0;
      }
      resources.set(n.resource, entry);
    }
  }

  const diagnostics: Diagnostic[] = [];
  const importCosts = new Map<string, ImportCost>();
  if (request.costImports && importCaps.size) {
    for (const item of [...importCaps.keys()].sort()) {
      const c = await embodiedCost(model, request, stack, item, backend, options);
      if ('cost' in c) importCosts.set(item, c);
      else diagnostics.push(c);
    }
    // Under O6, a resource type only imports bring in still counts once.
    if (stack.includes('resourceTypes'))
      for (const c of importCosts.values())
        for (const r of c.resourceTypes)
          if (!resources.has(r)) resources.set(r, { recipes: [], cap: 0 });
  }

  const problem: Problem = {
    model,
    stack,
    tolerance: request.tolerance ?? DEFAULT_TOLERANCE,
    whole: request.wholeMachines ?? false,
    recipes,
    items,
    demand,
    scaled,
    importCaps,
    nodeCaps,
    nodes,
    costs,
    resources,
    importCosts,
  };
  const result = await solveStack(problem, backend, options, itemName, diagnostics);
  if (request.costImports && result.status === 'ok')
    result.importCosts = [...importCosts.values()].sort(byItem);
  return result;
}

/**
 * The lexicographic driver (§3.3): solves each objective of the stack in
 * order, holding every earlier one at `f_k ≤ f_k* + tol·max(|f_k*|, ε)`. A
 * later stage that fails is retried once at 10× tolerance, with a warning (§3.5).
 */
async function solveStack(
  p: Problem,
  backend: LpBackend,
  options: LpOptions,
  itemName: (id: string) => string,
  diagnostics: Diagnostic[],
): Promise<SolveResult> {
  const optima: { objective: ObjectiveId; optimum: number; gap?: number }[] = [];
  let tolerance = p.tolerance;
  let stats: SolveStats = { recipes: p.recipes.length, columns: 0, rows: 0 };
  let sol: LpSolution | undefined;
  for (const [k, objective] of p.stack.entries()) {
    const run = async (tol: number) => {
      const lp = buildLp(p, 'normal', objective, lexLocks(p, optima, tol));
      if (k === 0) stats = { ...stats, columns: lp.variables.length, rows: lp.constraints.length };
      if (!lp.variables.some((v) => v.integer)) return backend.solve(lp, options);
      const milpOptions: LpOptions = {
        ...options,
        timeLimitSeconds: options.timeLimitSeconds ?? MILP_TIME_LIMIT_SECONDS,
      };
      // Warm start from the LP relaxation with integers rounded up: without it,
      // a time-limited MILP can return a far worse incumbent.
      const relaxed = await backend.solve(
        { ...lp, variables: lp.variables.map(({ integer: _, ...v }) => v) },
        milpOptions,
      );
      if (!usable(relaxed)) return backend.solve(lp, milpOptions);
      const integer = new Set(lp.variables.filter((v) => v.integer).map((v) => v.name));
      const start = new Map(
        [...relaxed.values!].map(([k, v]) => [k, integer.has(k) ? Math.ceil(v - 1e-9) : v]),
      );
      return backend.solve(lp, { ...milpOptions, start });
    };
    let s = await run(tolerance);
    if (k === 0 && !usable(s)) return interpret(p, s, stats, backend, options, itemName);
    if (!usable(s)) {
      const raw = s.rawStatus;
      tolerance = Math.min(MAX_TOLERANCE, tolerance * 10);
      s = await run(tolerance);
      if (!usable(s))
        return numerical(
          p.stack,
          stats,
          `stage ${k + 1} (${objective}) failed (${raw}), and again at ${pct(tolerance)} tolerance (${s.rawStatus})`,
        );
      diagnostics.push({
        code: 'tolerance-relaxed',
        severity: 'warning',
        message: `Stage ${k + 1} (${objective}) was infeasible at ${pct(p.tolerance)} tolerance (${raw}); solved at ${pct(tolerance)} instead.`,
        tolerance,
      });
    }
    if (s.status !== 'optimal') {
      diagnostics.push({
        code: 'time-limit',
        severity: 'warning',
        message:
          `The solver stopped (${s.rawStatus}) in stage ${k + 1} (${objective}); ` +
          'this is the best plan found and may not be optimal' +
          (s.gap !== undefined ? ` (gap ${pct(s.gap)}).` : '.'),
        ...(s.gap !== undefined ? { gap: s.gap } : {}),
      });
    }
    optima.push({
      objective,
      optimum: stageValue(p, objective, s.values!),
      ...(s.gap !== undefined && s.status !== 'optimal' ? { gap: s.gap } : {}),
    });
    sol = s;
  }
  const result = finish(p, sol!, stats, diagnostics);
  if (result.status !== 'ok') return result;
  result.stages = optima.map((o): StageResult => ({
    ...o,
    value: stageValue(p, o.objective, sol!.values!),
  }));
  result.objectiveValue = result.stages[0]!.value;
  return result;
}

const usable = (s: LpSolution) =>
  s.values !== undefined &&
  (s.status === 'optimal' || s.status === 'time-limit' || s.status === 'iteration-limit');

const pct = (f: number) => `${Math.round(f * 1e6) / 1e4}%`;

/** Lexicographic rows holding each solved stage within tolerance of its optimum (min form). */
function lexLocks(
  p: Problem,
  optima: readonly { objective: ObjectiveId; optimum: number }[],
  tolerance: number,
): LpConstraint[] {
  return optima.map(({ objective, optimum }) => {
    const f = objective === 'output' ? -optimum : optimum;
    return {
      name: lexRow(objective),
      terms: objectiveTerms(p, objective),
      hi: f + tolerance * Math.max(Math.abs(f), LEX_EPSILON),
    };
  });
}

/** An objective as min-form LP terms, without the regularizer (§3.3). */
function objectiveTerms(p: Problem, objective: ObjectiveId): LpTerm[] {
  if (objective === 'output') return [{ var: OUTPUT_VAR, coef: -1 }];
  if (objective === 'resourceTypes')
    return [...p.resources.keys()].sort().map((r) => ({ var: typeVar(r), coef: 1 }));
  const terms: LpTerm[] = [];
  const cost = p.costs.get(objective)!;
  for (const r of p.recipes) {
    const c = cost.get(r.id) ?? 0;
    if (c === 0) continue;
    terms.push({
      var: objective === 'machines' && p.whole ? machinesVar(r.id) : recipeVar(r.id),
      coef: c,
    });
  }
  for (const [item, ic] of [...p.importCosts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const c = ic.cost[objective] ?? 0;
    if (c !== 0) terms.push({ var: importVar(item), coef: c });
  }
  return terms;
}

/** An objective's value on a solution, in its natural sense (O5 is the scale reached). */
function stageValue(p: Problem, objective: ObjectiveId, values: Map<string, number>): number {
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

const embodiedCache = new WeakMap<Model, Map<string, ImportCost | Diagnostic>>();

/**
 * Embodied cost of 1/min of an unassigned import (§3.3): the stack's values on
 * a standalone plan that makes 1/min of it from the map pool, with no imports.
 * Cached per model and settings.
 */
async function embodiedCost(
  model: Model,
  request: SolveRequest,
  stack: readonly ObjectiveId[],
  item: string,
  backend: LpBackend,
  options: LpOptions,
): Promise<ImportCost | Diagnostic> {
  const standalone: SolveRequest = {
    targets: [{ item, rate: 1 }],
    objectives: stack.filter((o) => o !== 'output'),
    ...(request.tolerance !== undefined ? { tolerance: request.tolerance } : {}),
    ...(request.scarcityWeights ? { scarcityWeights: request.scarcityWeights } : {}),
    ...(request.recipes ? { recipes: request.recipes } : {}),
  };
  if (!standalone.objectives!.length) return { item, cost: {}, resourceTypes: [] };
  const key = JSON.stringify(standalone);
  let cache = embodiedCache.get(model);
  if (!cache) embodiedCache.set(model, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const r = await solve(model, standalone, backend, options);
  const nodes = new Map(model.nodes.map((n) => [n.id, n.resource]));
  const out: ImportCost | Diagnostic =
    r.status === 'ok'
      ? {
          item,
          cost: Object.fromEntries(
            r.stages
              .filter((s) => s.objective !== 'resourceTypes')
              .map((s) => [s.objective, s.value]),
          ),
          resourceTypes: [...new Set(r.nodes.map((n) => nodes.get(n.node) ?? n.node))].sort(),
        }
      : {
          code: 'import-cost',
          severity: 'warning',
          item,
          message: `Could not cost imported ${item}: its standalone plan is ${r.status}. The import is treated as free.`,
        };
  // Time-limited plans are not cached: a later solve may do better.
  if (r.diagnostics.every((d) => d.code !== 'time-limit')) cache.set(key, out);
  return out;
}

/** Stage 1 returned no usable plan: diagnose why (§3.5). */
async function interpret(
  p: Problem,
  sol: LpSolution,
  stats: SolveStats,
  backend: LpBackend,
  options: LpOptions,
  itemName: (id: string) => string,
): Promise<SolveResult> {
  switch (sol.status) {
    case 'optimal':
      return numerical(p.stack, stats, `${sol.rawStatus} without a solution`);
    case 'time-limit':
    case 'iteration-limit':
      return {
        ...emptyResult('error', p.stack, stats),
        diagnostics: [
          {
            code: 'time-limit',
            severity: 'warning',
            message: `The solver stopped (${sol.rawStatus}) before finding any plan.`,
          },
        ],
      };
    case 'infeasible':
      return elastic(p, stats, backend, options, itemName);
    case 'unbounded':
    case 'infeasible-or-unbounded': {
      // Re-solve with every variable capped: a solution names the unbounded
      // direction; infeasibility means the original LP was infeasible.
      const capped = await backend.solve(buildLp(p, 'capped', p.stack[0]!), options);
      if (capped.status === 'optimal' && capped.values) {
        const directions = [...capped.values]
          .filter(([, v]) => v >= SANITY_CAP * (1 - 1e-6))
          .map(([k]) => k)
          .sort();
        return {
          ...emptyResult('unbounded', p.stack, stats),
          diagnostics: [
            {
              code: 'unbounded',
              severity: 'error',
              message:
                `The plan can grow without limit along ${directions.join(', ') || 'an unknown direction'}. ` +
                'Add a cap (an import limit or node budget) to bound it.',
              directions,
            },
          ],
        };
      }
      if (capped.status === 'infeasible') return elastic(p, stats, backend, options, itemName);
      return numerical(p.stack, stats, capped.rawStatus);
    }
    case 'error':
      return numerical(p.stack, stats, sol.rawStatus);
  }
}

/**
 * Infeasible (§3.5): re-solve with slack on node caps and import caps,
 * minimizing the relaxation, and report what would make the plan feasible.
 */
async function elastic(
  p: Problem,
  stats: SolveStats,
  backend: LpBackend,
  options: LpOptions,
  itemName: (id: string) => string,
): Promise<SolveResult> {
  const sol = await backend.solve(buildLp(p, 'elastic', p.stack[0]!), options);
  if (sol.status !== 'optimal' || !sol.values) return numerical(p.stack, stats, sol.rawStatus);
  const relaxations: Relaxation[] = [];
  for (const node of [...p.nodeCaps.keys()].sort()) {
    const amount = sol.values.get(nodeSlackVar(node)) ?? 0;
    if (amount > SLACK_TOL) relaxations.push({ kind: 'node', node, amount });
  }
  for (const item of [...p.importCaps.keys()].sort()) {
    if (!Number.isFinite(p.importCaps.get(item))) continue;
    const amount = sol.values.get(importSlackVar(item)) ?? 0;
    if (amount > SLACK_TOL) relaxations.push({ kind: 'import', item, amount });
  }
  const describe = (r: Relaxation): string => {
    if (r.kind === 'import') return `${fmt(r.amount)}/min more imported ${itemName(r.item)}`;
    const n = p.nodes.get(r.node);
    if (!n) return `${fmt(r.amount)} more of node ${r.node}`;
    return n.purity === 'site'
      ? `${fmt(r.amount)} more ${itemName(n.resource)} fracking sites`
      : `${fmt(r.amount)} more ${n.purity} ${itemName(n.resource)} nodes`;
  };
  return {
    ...emptyResult('infeasible', p.stack, stats),
    diagnostics: [
      {
        code: 'infeasible',
        severity: 'error',
        message: relaxations.length
          ? `Infeasible: needs ${relaxations.map(describe).join(' and ')}.`
          : 'Infeasible, but no node or import relaxation fixes it.',
        relaxations,
      },
    ],
  };
}

type LpMode = 'normal' | 'elastic' | 'capped';

/**
 * `normal`: the stage LP/MILP with its objective and lexicographic locks.
 * `elastic`: slack on node and import caps, minimizing the relaxation (an LP:
 * integer parts are left out). `capped`: every variable capped at the sanity
 * cap, to name an unbounded direction.
 */
function buildLp(
  p: Problem,
  mode: LpMode,
  stage: ObjectiveId,
  locks: LpConstraint[] = [],
): LpModel {
  const variables: LpVariable[] = [];
  const objective: LpTerm[] = [];
  const balance = new Map<string, LpTerm[]>(p.items.map((i) => [i, []]));
  const nodeTerms = new Map<string, LpTerm[]>();
  const constraints: LpConstraint[] = [];
  const cap = mode === 'capped' ? SANITY_CAP : Infinity;
  const whole = p.whole && mode !== 'elastic';
  // O6 indicators from its own stage on; earlier stages stay LPs.
  const o6 = p.stack.indexOf('resourceTypes');
  const types = mode !== 'elastic' && o6 >= 0 && o6 <= p.stack.indexOf(stage);

  for (const r of p.recipes) {
    const v = recipeVar(r.id);
    variables.push({ name: v, lo: 0, hi: cap });
    if (mode !== 'elastic') objective.push({ var: v, coef: REGULARIZER });
    for (const f of r.outputs) balance.get(f.item)!.push({ var: v, coef: f.rate });
    for (const f of r.inputs) balance.get(f.item)!.push({ var: v, coef: -f.rate });
    // In whole-machines mode a node is used by a whole machine, even underclocked (R3).
    const user = whole ? machinesVar(r.id) : v;
    if (r.node) nodeTerms.set(r.node, [...(nodeTerms.get(r.node) ?? []), { var: user, coef: 1 }]);
    if (whole) {
      variables.push({ name: machinesVar(r.id), lo: 0, hi: cap, integer: true });
      objective.push({ var: machinesVar(r.id), coef: REGULARIZER });
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
  if (mode !== 'elastic') objective.push(...objectiveTerms(p, stage));

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
  for (const item of p.items) {
    const v = surplusVar(item);
    variables.push({ name: v, lo: 0, hi: cap });
    balance.get(item)!.push({ var: v, coef: -1 });
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
  return { sense: 'min', objective, variables, constraints };
}

/** Cost per machine of each recipe under one objective (§3.3); recipes without a cost are left out. */
function objectiveCosts(
  model: Model,
  objective: ObjectiveId,
  weights: Readonly<Record<string, number>> | undefined,
  recipes: readonly Recipe[],
  nodes: Map<string, ResourceNode>,
): Map<string, number> {
  const cost = new Map<string, number>();
  if (objective === 'machines') {
    for (const r of recipes) cost.set(r.id, 1);
    return cost;
  }
  if (objective === 'power') {
    // Machine draw only: generation never lowers it, so O4 has no reason to
    // start otherwise-idle generators.
    for (const r of recipes) if (r.powerMW > 0) cost.set(r.id, r.powerMW);
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

/** Post-processing and the mandatory solution checks. */
function finish(
  p: Problem,
  sol: LpSolution,
  stats: SolveStats,
  diagnostics: Diagnostic[],
): SolveResult {
  const values = sol.values!;
  const negative = [...values].filter(([, v]) => v < -NONNEG_TOL);
  if (negative.length) {
    return checkFailed(
      p.stack,
      stats,
      `negative variables: ${negative.map(([k, v]) => `${k}=${v}`).join(', ')}`,
    );
  }
  // Tiny negatives within tolerance are reported as 0; positives are kept as
  // they are, so that small demands still balance.
  const val = (k: string) => Math.max(0, values.get(k) ?? 0);

  const x = new Map(p.recipes.map((r) => [r.id, val(recipeVar(r.id))]));
  const imported = new Map<string, number>();
  const surplus = new Map<string, number>();
  for (const item of p.items) {
    let s = p.importCaps.has(item) ? val(importVar(item)) : 0;
    let z = val(surplusVar(item));
    // An import that only feeds surplus is a no-op: cancel it.
    const both = Math.min(s, z);
    s -= both;
    z -= both;
    if (s > 0) imported.set(item, s);
    if (z > 0) surplus.set(item, z);
  }

  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const recipes: RecipeUsage[] = [];
  const nodeUse = new Map<string, number>();
  let consumptionMW = 0;
  let generationMW = 0;
  for (const r of p.recipes) {
    const n = x.get(r.id)!;
    if (n <= 0) continue;
    for (const f of r.outputs) add(produced, f.item, f.rate * n);
    for (const f of r.inputs) add(consumed, f.item, f.rate * n);
    // Whole-machines mode: the solved integer count (integral up to the MIP tolerance).
    const whole = p.whole ? Math.round(val(machinesVar(r.id))) : Math.ceil(n - 1e-6);
    if (r.node) add(nodeUse, r.node, p.whole ? whole : n);
    const power = r.powerMW * n;
    if (power >= 0) consumptionMW += power;
    else generationMW -= power;
    recipes.push({
      id: r.id,
      name: r.name,
      machine: r.machine,
      machines: n,
      machinesCeil: whole,
      powerMW: power,
    });
  }

  const items: ItemFlow[] = [];
  const failures: string[] = [];
  const scale = p.scaled.size ? val(OUTPUT_VAR) : 0;
  if (p.whole)
    for (const r of p.recipes) {
      const n = x.get(r.id)!;
      const m = val(machinesVar(r.id));
      if (n > m + BALANCE_TOL * Math.max(1, m))
        failures.push(`recipe ${r.id} runs ${n} machines but builds ${m}`);
    }
  for (const item of p.items) {
    const flow: ItemFlow = {
      item,
      produced: produced.get(item) ?? 0,
      consumed: consumed.get(item) ?? 0,
      imported: imported.get(item) ?? 0,
      surplus: surplus.get(item) ?? 0,
      demand: (p.demand.get(item) ?? 0) + (p.scaled.get(item) ?? 0) * scale,
    };
    const residual = flow.produced - flow.consumed + flow.imported - flow.surplus - flow.demand;
    const size = Math.max(1, flow.produced, flow.consumed, flow.imported, flow.demand);
    if (Math.abs(residual) > BALANCE_TOL * size)
      failures.push(`item ${item} out of balance by ${residual}`);
    if (flow.produced || flow.consumed || flow.imported || flow.surplus || flow.demand)
      items.push(flow);
  }
  for (const [item, s] of imported) {
    const c = p.importCaps.get(item) ?? 0;
    if (s > c + BALANCE_TOL * Math.max(1, c)) failures.push(`import ${item} ${s} exceeds cap ${c}`);
  }
  const nodes: NodeUsage[] = [];
  for (const [node, used] of [...nodeUse].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const budget = p.nodeCaps.get(node) ?? 0;
    if (used > budget + BALANCE_TOL * Math.max(1, budget))
      failures.push(`node ${node} usage ${used} exceeds budget ${budget}`);
    nodes.push({ node, used, budget, nne: used * (p.nodes.get(node)?.nne ?? 0) });
  }
  if (failures.length) return checkFailed(p.stack, stats, failures.join('; '));

  return {
    status: 'ok',
    objective: p.stack[0]!,
    objectives: [...p.stack],
    stages: [],
    ...(p.scaled.size ? { outputScale: scale } : {}),
    recipes,
    items,
    imports: toRates(imported),
    surplus: toRates(surplus),
    nodes,
    power: { consumptionMW, generationMW, netMW: consumptionMW - generationMW },
    diagnostics,
    stats,
  };
}

function validate(
  model: Model,
  request: SolveRequest,
  stack: readonly ObjectiveId[],
): Diagnostic | undefined {
  const bad = (message: string): Diagnostic => ({
    code: 'invalid-request',
    severity: 'error',
    message,
  });
  const known = new Set(model.items.map((i) => i.id));
  if (request.objective !== undefined && request.objectives !== undefined)
    return bad('Give either `objective` or `objectives`, not both.');
  if (!stack.length) return bad('The objective stack is empty.');
  for (const [k, o] of stack.entries()) {
    if (!OBJECTIVE_IDS.includes(o)) return bad(`Unknown objective "${String(o)}".`);
    if (stack.indexOf(o) !== k) return bad(`Objective "${o}" appears twice in the stack.`);
    if (o === 'output' && k !== 0)
      return bad('The `output` objective (maximize output) can only come first in the stack.');
  }
  if (stack[0] === 'output' && !request.targets.some((t) => t.rate > 0))
    return bad('Maximizing output needs at least one target to set the output ratio.');
  if (request.tolerance !== undefined) {
    const t = request.tolerance;
    if (!Number.isFinite(t) || t < MIN_TOLERANCE || t > MAX_TOLERANCE)
      return bad(
        `Tolerance must be between ${pct(MIN_TOLERANCE)} and ${pct(MAX_TOLERANCE)} (got ${Number.isFinite(t) ? pct(t) : t}).`,
      );
  }
  for (const t of [...request.targets, ...(request.demand ?? [])]) {
    if (!known.has(t.item)) return bad(`Unknown item "${t.item}".`);
    if (!Number.isFinite(t.rate) || t.rate < 0)
      return bad(`Rate for ${t.item} must be a finite number ≥ 0 (got ${t.rate}).`);
    if (t.rate > 0 && t.rate < MIN_RATE)
      return bad(`Rate for ${t.item} must be 0 or at least ${MIN_RATE}/min (got ${t.rate}).`);
  }
  for (const i of request.imports ?? []) {
    if (!known.has(i.item)) return bad(`Unknown import item "${i.item}".`);
    if (Number.isNaN(i.cap) || i.cap < 0)
      return bad(`Import cap for ${i.item} must be ≥ 0 (got ${i.cap}).`);
  }
  for (const [r, w] of Object.entries(request.scarcityWeights ?? {}))
    if (!Number.isFinite(w) || w < 0)
      return bad(`Scarcity weight for ${r} must be a finite number ≥ 0 (got ${w}).`);
  if (request.nodeBudget && request.nodeBudget !== 'pool')
    for (const [n, c] of Object.entries(request.nodeBudget))
      if (Number.isNaN(c) || c < 0) return bad(`Node budget for ${n} must be ≥ 0 (got ${c}).`);
  return undefined;
}

const toRates = (m: Map<string, number>): ItemRate[] =>
  [...m].map(([item, rate]) => ({ item, rate })).sort(byItem);

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function emptyResult(
  status: SolveResult['status'],
  stack: readonly ObjectiveId[],
  stats: SolveStats = { recipes: 0, columns: 0, rows: 0 },
): SolveResult {
  return {
    status,
    objective: stack[0] ?? 'resources',
    objectives: [...stack],
    stages: [],
    recipes: [],
    items: [],
    imports: [],
    surplus: [],
    nodes: [],
    power: { consumptionMW: 0, generationMW: 0, netMW: 0 },
    diagnostics: [],
    stats,
  };
}

function failed(
  status: SolveResult['status'],
  stack: readonly ObjectiveId[],
  diagnostics: Diagnostic[],
): SolveResult {
  return { ...emptyResult(status, stack), diagnostics };
}

const numerical = (stack: readonly ObjectiveId[], stats: SolveStats, raw: string): SolveResult => ({
  ...emptyResult('error', stack, stats),
  diagnostics: [{ code: 'numerical', severity: 'error', message: `The LP solver failed: ${raw}.` }],
});

const checkFailed = (
  stack: readonly ObjectiveId[],
  stats: SolveStats,
  detail: string,
): SolveResult => ({
  ...emptyResult('error', stack, stats),
  diagnostics: [
    {
      code: 'check-failed',
      severity: 'error',
      message: `The solved plan failed its checks: ${detail}.`,
    },
  ],
});
