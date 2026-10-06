import { MW_ITEM_ID, type Flow, type Model, type Recipe, type ResourceNode } from '@sps/data';
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
import { filterRecipes, parseTier } from './recipes';
import { extractionOf } from './resources';
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
  ResourceExtraction,
  SolveRequest,
  SolveResult,
  SolveStats,
  StageResult,
} from './types';

/** Tie-break weight on Σx (§3.3): picks a stable plan among equal-cost ones. */
const REGULARIZER = 1e-9;
/** Sanity cap used to name the direction of an unbounded LP (§3.5). */
const SANITY_CAP = 1e7;
/** MILP row tolerance of the retry when a plan fails to polish (see `LpOptions`). */
const TIGHT_MIP_FEASIBILITY = 1e-10;
/** How far the post-MILP polish may move the stage objective, relative (see `polish`). */
const POLISH_SLACK = 1e-10;
/** Elastic re-solve: cost of 1/min of extra import, in normal-node-equivalents. */
const IMPORT_SLACK_COST = 0.01;
/** Elastic re-solve: cost of 1/min more of a limited resource (A33), in normal-node-equivalents. */
const RESOURCE_SLACK_COST = 0.001;
/** Elastic re-solve: cost of 1/min of a fluid byproduct left over against `avoidFluidByproducts` (A39). */
const SURPLUS_SLACK_COST = 0.001;
/** Fluids that are easy to dump, so `avoidFluidByproducts` still lets them be left over (A39). */
export const DUMPABLE_FLUIDS: readonly string[] = ['energetic-dark-matter', 'flue-gas', 'steam'];
/** Solution checks (CLAUDE.md): balance within 1e-6, variables ≥ −1e-9, nodes ≤ budget, resources ≤ limit. */
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
/** Default smallest branch kept, in machines (A34): 1% of a machine. */
export const MIN_BRANCH = 0.01;
/** Most LP solves the prune pass may spend on one plan (A34). */
const MAX_PRUNE_ATTEMPTS = 24;
/** Default time limit of a MILP stage, in seconds (§3.4). */
export const MILP_TIME_LIMIT_SECONDS = 5;
/** Elastic slack below this is solver noise, not a relaxation. */
const SLACK_TOL = 1e-9;

const recipeVar = (id: string) => `recipe:${id}`;
const importVar = (item: string) => `import:${item}`;
const surplusVar = (item: string) => `surplus:${item}`;
const nodeSlackVar = (node: string) => `slack:node:${node}`;
const importSlackVar = (item: string) => `slack:import:${item}`;
const resourceSlackVar = (item: string) => `slack:resource:${item}`;
const surplusSlackVar = (item: string) => `slack:surplus:${item}`;
const balanceRow = (item: string) => `balance:${item}`;
const nodeRow = (node: string) => `cap:${node}`;
const importRow = (item: string) => `importcap:${item}`;
const resourceRow = (item: string) => `limit:${item}`;
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
  /** `request.minBranch`, in machines (A34). */
  minBranch: number;
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
  const { enabled, disabled } = filterRecipes([...model.recipes].sort(byId), request.recipes);
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

  const fluids = new Set(model.items.filter((i) => i.form === 'fluid').map((i) => i.id));
  const noSurplus = new Set(
    request.avoidFluidByproducts
      ? items.filter((i) => fluids.has(i) && !DUMPABLE_FLUIDS.includes(i))
      : [],
  );

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
  const extracts = new Map<string, { item: string; rate: number }>();
  const resourceLimits = new Map<string, number>();
  for (const r of recipes) {
    const e = extractionOf(r, (id) => nodes.get(id)?.resource);
    if (!e) continue;
    extracts.set(r.id, e);
    const limit = request.resourceLimits?.[e.item];
    if (limit !== undefined && Number.isFinite(limit)) resourceLimits.set(e.item, limit);
  }
  const costs = new Map(
    stack.map((o) => [
      o,
      objectiveCosts(model, o, request.scarcityWeights, recipes, nodes, stack.indexOf('power') > 0),
    ]),
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

  const problem: Problem = {
    model,
    stack,
    tolerance: request.tolerance ?? DEFAULT_TOLERANCE,
    whole: request.wholeMachines ?? false,
    minBranch: request.minBranch ?? MIN_BRANCH,
    recipes,
    items,
    demand,
    scaled,
    importCaps,
    nodeCaps,
    nodes,
    extracts,
    resourceLimits,
    noSurplus,
    costs,
    resources,
    importCosts: new Map(),
    turbineCaps: new Map(),
    ...(request.scarcityWeights ? { scarcityWeights: request.scarcityWeights } : {}),
    ...(request.marginalCosts
      ? {
          marginal: {
            items: [...new Set(request.marginalCosts.items)].sort(),
            objectives: [...new Set(request.marginalCosts.objectives)].filter(
              (o) => o !== 'output' && o !== 'resourceTypes',
            ),
          },
        }
      : {}),
  };
  if (!request.costImports || !importCaps.size)
    return solveStack(problem, backend, options, itemName, []);
  return solveCosted(problem, request, backend, options, itemName);
}

/** Most re-costing rounds of `solveCosted` before it settles for the best plan seen. */
const MAX_COST_ROUNDS = 4;

/**
 * Costed imports (§3.3, A18): each unassigned import is costed at the rate the
 * plan actually imports it, because heater fuel (A17) makes the cost of a rate
 * a step function, not rate × the cost of 1/min. The plan is first solved with
 * free imports; each import is then costed at that rate (1/min if unused) and
 * the plan re-solved, until the costs it was solved with match the costs at
 * its own import rates. An import the plan stops using keeps its last rate.
 * Step costs can make this cycle (a cheap average at a high rate invites a
 * small import, whose own cost is higher): then, or after MAX_COST_ROUNDS, the
 * best plan seen is returned, re-costed at its own import rates, with a warning.
 */
async function solveCosted(
  base: Problem,
  request: SolveRequest,
  backend: LpBackend,
  options: LpOptions,
  itemName: (id: string) => string,
): Promise<SolveResult> {
  // Given costs (linked imports, from the world layer) are used as they are.
  const given = new Map<string, ImportCost>();
  for (const c of request.importCosts ?? [])
    if (base.importCaps.has(c.item)) given.set(c.item, { ...c, cost: { ...c.cost } });
  const items = [...base.importCaps.keys()].filter((i) => !given.has(i)).sort();
  if (!items.length) {
    const plan = await solveStack(
      { ...base, importCosts: given, resources: withImportTypes(base, given) },
      backend,
      options,
      itemName,
      [],
    );
    if (plan.status === 'ok') plan.importCosts = [...given.values()].sort(byItem);
    return plan;
  }
  const free = await solveStack(
    { ...base, turbineCaps: new Map() },
    backend,
    options,
    itemName,
    [],
  );
  if (free.status !== 'ok') return free;
  const rates = new Map(items.map((i) => [i, 1]));
  const costAt = async (plan: SolveResult) => {
    // Rates below MIN_RATE are solver noise, and below what a standalone plan can target.
    for (const i of plan.imports)
      if (rates.has(i.item) && i.rate >= MIN_RATE) rates.set(i.item, i.rate);
    const warnings: Diagnostic[] = [];
    const costs = new Map<string, ImportCost>(given);
    for (const item of items) {
      const c = await embodiedCost(
        base.model,
        request,
        base.stack,
        item,
        rates.get(item)!,
        backend,
        options,
      );
      if ('cost' in c) costs.set(item, c);
      else warnings.push(c);
    }
    return { costs, warnings };
  };
  /** Plans solved so far, each with the costs it was solved with and the costs at its own rates. */
  const seen: {
    plan: SolveResult;
    solvedWith: Map<string, ImportCost>;
    own: Map<string, ImportCost>;
  }[] = [];
  let next = await costAt(free);
  for (let round = 0; ; round++) {
    const costs = next.costs;
    const resources = withImportTypes(base, costs);
    const plan = await solveStack(
      { ...base, importCosts: costs, resources, turbineCaps: new Map() },
      backend,
      options,
      itemName,
      next.warnings,
    );
    if (plan.status !== 'ok') return plan;
    next = await costAt(plan);
    seen.push({ plan, solvedWith: costs, own: next.costs });
    if (sameCosts(costs, next.costs)) {
      // Same costs; report them at the rates this plan imports.
      plan.importCosts = [...next.costs.values()].sort(byItem);
      return plan;
    }
    const cycle = seen.slice(0, -1).some((x) => sameCosts(x.solvedWith, next.costs));
    if (cycle || round + 1 >= MAX_COST_ROUNDS) break;
  }
  // No fixed point: re-cost every plan at its own rates and keep the best.
  const recosted = seen.map(({ plan, solvedWith, own }) => recost(plan, solvedWith, own));
  const best = recosted.reduce((a, b) => (lexBetter(b, a) ? b : a));
  best.diagnostics.push({
    code: 'import-cost',
    severity: 'warning',
    item: items.join(', '),
    message:
      'Import costs did not settle when re-costed at the imported rates (whole heaters make costs step-shaped); ' +
      'this is the cheapest plan found, costed at its own import rates.',
  });
  return best;
}

/** Under O6, a resource type that only imports bring in still counts once. */
function withImportTypes(
  base: Problem,
  costs: ReadonlyMap<string, ImportCost>,
): Problem['resources'] {
  const resources = new Map(base.resources);
  if (base.stack.includes('resourceTypes'))
    for (const c of costs.values())
      for (const r of c.resourceTypes)
        if (!resources.has(r)) resources.set(r, { recipes: [], cap: 0 });
  return resources;
}

/** A plan's stage values with its imports charged `own` instead of `solvedWith` costs. */
function recost(
  plan: SolveResult,
  solvedWith: Map<string, ImportCost>,
  own: Map<string, ImportCost>,
): SolveResult {
  const shift = (o: ObjectiveId) =>
    plan.imports.reduce(
      (sum, i) =>
        sum + ((own.get(i.item)?.cost[o] ?? 0) - (solvedWith.get(i.item)?.cost[o] ?? 0)) * i.rate,
      0,
    );
  const stages = plan.stages.map((s) =>
    s.objective === 'output' || s.objective === 'resourceTypes'
      ? s
      : { ...s, value: s.value + shift(s.objective) },
  );
  return {
    ...plan,
    stages,
    objectiveValue: stages[0]!.value,
    importCosts: [...own.values()].sort(byItem),
    diagnostics: [...plan.diagnostics],
  };
}

/** True when `a`'s stage values beat `b`'s lexicographically (min sense; output is maximized). */
function lexBetter(a: SolveResult, b: SolveResult): boolean {
  for (const [k, s] of a.stages.entries()) {
    const sign = s.objective === 'output' ? -1 : 1;
    const x = sign * s.value;
    const y = sign * b.stages[k]!.value;
    if (Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))) return x < y;
  }
  return false;
}

/** Same cost per objective (1e-9 relative) and resource types, for every item. */
function sameCosts(a: Map<string, ImportCost>, b: Map<string, ImportCost>): boolean {
  if (a.size !== b.size) return false;
  for (const [item, x] of a) {
    const y = b.get(item);
    if (!y || x.resourceTypes.join() !== y.resourceTypes.join()) return false;
    const keys = new Set([...Object.keys(x.cost), ...Object.keys(y.cost)]) as Set<ObjectiveId>;
    for (const k of keys) {
      const u = x.cost[k] ?? 0;
      const v = y.cost[k] ?? 0;
      if (Math.abs(u - v) > 1e-9 * Math.max(1, Math.abs(u), Math.abs(v))) return false;
    }
  }
  return true;
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
    if (objective === 'power' && sol?.values) {
      // "When required": O4 keeps conversion generators at most at the count
      // the earlier stages run, so its credit never starts new ones.
      for (const r of p.recipes)
        if ((p.costs.get('power')!.get(r.id) ?? 0) < 0)
          p.turbineCaps.set(r.id, Math.max(0, sol.values.get(recipeVar(r.id)) ?? 0));
    }
    const run = async (tol: number) => {
      const lp = buildLp(p, 'normal', objective, lexLocks(p, optima, tol));
      if (k === 0) stats = { ...stats, columns: lp.variables.length, rows: lp.constraints.length };
      const terms = scaledTerms(p, objective);
      if (!lp.variables.some((v) => v.integer))
        return tidy(lp, await backend.solve(lp, options), terms, 0, backend, options);
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
      const integer = new Set(lp.variables.filter((v) => v.integer).map((v) => v.name));
      const start = usable(relaxed)
        ? new Map(
            [...relaxed.values!].map(([k, v]) => [k, integer.has(k) ? Math.ceil(v - 1e-9) : v]),
          )
        : undefined;
      const mip = await backend.solve(lp, start ? { ...milpOptions, start } : milpOptions);
      const polished = await polish(lp, mip, integer, terms, backend, milpOptions);
      if (polished) return polished;
      // The machine counts don't hold up at LP precision: the MILP met a tiny
      // demand within its feasibility tolerance. Solve it again, tighter.
      const tight: LpOptions = { ...milpOptions, mipFeasibilityTolerance: TIGHT_MIP_FEASIBILITY };
      const again = await backend.solve(lp, start ? { ...tight, start } : tight);
      return (await polish(lp, again, integer, terms, backend, milpOptions)) ?? again;
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
  const pruned = await pruneBranches(p, sol!, optima, tolerance, backend, options);
  sol = pruned.sol;
  if (pruned.banned.length) stats = { ...stats, pruned: pruned.banned };
  const result = finish(p, sol!, stats, diagnostics);
  if (result.status !== 'ok') return result;
  result.stages = optima.map((o): StageResult => ({
    ...o,
    value: stageValue(p, o.objective, sol!.values!),
  }));
  result.objectiveValue = result.stages[0]!.value;
  if (p.marginal) result.marginalCosts = await marginalCosts(p, result, sol!, backend, options);
  return result;
}

/**
 * The prune pass (§3.3, A34). An LP spends every bit of room the stack leaves
 * it: a later stage uses the earlier stages' tolerance, and ties come back as
 * arbitrary vertices, so a plan can carry slivers of other routes (a miner at
 * 0.000002 machines) that buy nothing worth building. The pass re-solves the
 * last stage on the plan's own recipes minus those running below `minBranch`
 * machines, under the same lexicographic locks (every stage within tolerance
 * of its optimum), and tidies it like any stage. Keeping to the plan's own
 * recipes stops the re-solve from spending the same room on new slivers.
 * Dropping all of them together is tried first, on the plan's own recipes and
 * then on every recipe not yet dropped (a sliver may stand in for a route the
 * plan doesn't run yet), then each alone in id order;
 * a drop that makes the plan infeasible is undone, so a branch the plan needs
 * stays. Integer variables are fixed at the plan's values (a dropped recipe's
 * count at 0), so every re-solve is an LP. Deterministic: candidates go in id
 * order.
 */
async function pruneBranches(
  p: Problem,
  sol: LpSolution,
  optima: readonly { objective: ObjectiveId; optimum: number }[],
  tolerance: number,
  backend: LpBackend,
  options: LpOptions,
): Promise<{ sol: LpSolution; banned: string[] }> {
  if (!(p.minBranch > 0) || !usable(sol)) return { sol, banned: [] };
  const last = p.stack[p.stack.length - 1]!;
  const terms = scaledTerms(p, last);
  const locks = lexLocks(p, optima, tolerance);
  const banned = new Set<string>();
  const needed = new Set<string>();
  let attempts = 0;
  const run = (plan: LpSolution, id: string) => plan.values!.get(recipeVar(id)) ?? 0;
  /** Re-solves with only `keep` allowed to run, or undefined when it fails. */
  const attempt = async (plan: LpSolution, keep: ReadonlySet<string>) => {
    attempts++;
    const lp = buildLp(p, 'normal', last, locks);
    const off = new Set(
      p.recipes.filter((r) => !keep.has(r.id)).flatMap((r) => [recipeVar(r.id), machinesVar(r.id)]),
    );
    const variables = lp.variables.map(({ integer, ...v }) => {
      if (off.has(v.name)) return { ...v, lo: 0, hi: 0 };
      if (!integer) return v;
      const n = Math.round(plan.values!.get(v.name) ?? 0);
      return { ...v, lo: n, hi: n };
    });
    const fixed = { ...lp, variables };
    const s = await backend.solve(fixed, options);
    if (s.status !== 'optimal' || !s.values) return undefined;
    const tidied = await tidy(fixed, s, terms, 0, backend, options);
    return { ...sol, values: tidied.values! };
  };
  while (attempts < MAX_PRUNE_ATTEMPTS) {
    const support = p.recipes.map((r) => r.id).filter((id) => run(sol, id) > 0);
    const small = support.filter((id) => run(sol, id) < p.minBranch && !needed.has(id));
    if (!small.length) break;
    const without = (drop: readonly string[]) =>
      new Set(support.filter((id) => !drop.includes(id)));
    const all =
      (await attempt(sol, without(small))) ??
      (await attempt(
        sol,
        new Set(p.recipes.map((r) => r.id).filter((id) => !banned.has(id) && !small.includes(id))),
      ));
    if (all) {
      for (const id of small) banned.add(id);
      sol = all;
      continue;
    }
    for (const id of small) {
      if (attempts >= MAX_PRUNE_ATTEMPTS) break;
      const one = await attempt(sol, without([id]));
      if (!one) {
        needed.add(id);
        continue;
      }
      banned.add(id);
      sol = one;
      // The plan changed: the next round recomputes its slivers.
      break;
    }
  }
  return { sol, banned: [...banned].sort() };
}

/**
 * Marginal cost per 1/min of each requested item the plan handles (A18): per
 * objective, the dual of the item's balance row in an LP of that objective
 * alone, without the tie-break regularizer, with every integer count (heaters
 * always, whole machines, O6 indicators) fixed at the plan's value. A MILP has
 * no duals; fixing the counts keeps a whole heater's fuel on this factory.
 * An objective whose LP fails is left out, so the consumer falls back to a
 * standalone plan for it.
 */
async function marginalCosts(
  p: Problem,
  plan: SolveResult,
  sol: LpSolution,
  backend: LpBackend,
  options: LpOptions,
): Promise<ImportCost[]> {
  const { items: wanted, objectives } = p.marginal!;
  const items = wanted.filter((i) => p.items.includes(i));
  const costs = new Map(items.map((i) => [i, {} as Partial<Record<ObjectiveId, number>>]));
  for (const o of objectives) {
    const q: Problem = p.costs.has(o)
      ? p
      : {
          ...p,
          costs: new Map([
            ...p.costs,
            [o, objectiveCosts(p.model, o, p.scarcityWeights, p.recipes, p.nodes)],
          ]),
        };
    const lp = buildLp(q, 'normal', o);
    const variables = lp.variables.map(({ integer, ...v }) => {
      if (!integer) return v;
      const n = Math.round(sol.values!.get(v.name) ?? 0);
      return { ...v, lo: n, hi: n };
    });
    const s = await backend.solve({ ...lp, objective: objectiveTerms(q, o), variables }, options);
    if (s.status !== 'optimal' || !s.duals) continue;
    for (const item of items) {
      const dual = s.duals.get(balanceRow(item)) ?? 0;
      // Free disposal makes duals ≥ 0; anything below is solver noise.
      costs.get(item)![o] = dual > SLACK_TOL ? dual : 0;
    }
  }
  const resourceOf = new Map(p.model.nodes.map((n) => [n.id, n.resource]));
  const resourceTypes = [
    ...new Set(plan.nodes.map((n) => resourceOf.get(n.node) ?? n.node)),
  ].sort();
  return items.map((item) => ({
    item,
    rate: plan.items.find((f) => f.item === item)?.demand ?? 0,
    cost: costs.get(item)!,
    resourceTypes,
  }));
}

/**
 * Re-solves a MILP's plan as LPs with its integer variables fixed at their
 * rounded values. The MILP is feasible only to the MIP tolerance (tiny
 * negative flows), and its 1e-9 tie-break regularizer sits below every solver
 * tolerance, so ties come back arbitrary: a heater could run its boiler flat
 * out and dump the steam. The first LP returns the plan at LP precision; the
 * second holds the stage objective at that value and minimizes Σx, so each
 * recipe runs only as hard as the plan needs (A17). Keeps the MILP's status
 * and gap. Returns the MILP solution as is when it has no plan, and undefined
 * when its machine counts are infeasible at LP precision.
 */
async function polish(
  lp: LpModel,
  mip: LpSolution,
  integer: ReadonlySet<string>,
  stage: LpTerm[],
  backend: LpBackend,
  options: LpOptions,
): Promise<LpSolution | undefined> {
  if (!usable(mip)) return mip;
  const variables = lp.variables.map(({ integer: _, ...v }) => {
    if (!integer.has(v.name)) return v;
    const n = Math.round(mip.values!.get(v.name) ?? 0);
    return { ...v, lo: n, hi: n };
  });
  const fixed = await backend.solve({ ...lp, variables }, options);
  if (fixed.status === 'infeasible') return undefined;
  if (fixed.status !== 'optimal' || !fixed.values) return mip;
  return {
    ...mip,
    values: (await tidy({ ...lp, variables }, fixed, stage, POLISH_SLACK, backend, options))
      .values!,
  };
}

/**
 * Holds a solved stage objective at its value and minimizes Σx, so each
 * recipe runs only as hard as the plan needs. The 1e-9 regularizer alone is
 * below the solver's tolerances, so an LP plan could otherwise process a free
 * capped import into surplus product, and a pull link would draw that excess
 * from its producer (R7). Keeps the solution's status; returns it as is when
 * it has no optimal plan or the tidy LP fails.
 */
async function tidy(
  lp: LpModel,
  sol: LpSolution,
  stage: LpTerm[],
  slack: number,
  backend: LpBackend,
  options: LpOptions,
): Promise<LpSolution> {
  if (sol.status !== 'optimal' || !sol.values) return sol;
  const value = stage.reduce((sum, t) => sum + t.coef * (sol.values!.get(t.var) ?? 0), 0);
  const tidied = await backend.solve(
    {
      ...lp,
      objective: lp.variables
        .filter((v) => v.name.startsWith('recipe:'))
        .map((v) => ({ var: v.name, coef: 1 })),
      constraints: [
        ...lp.constraints,
        { name: 'polish', terms: stage, hi: value + slack * Math.max(1, Math.abs(value)) },
      ],
    },
    options,
  );
  return tidied.status === 'optimal' && tidied.values ? { ...sol, values: tidied.values } : sol;
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
    const scale = objectiveScale(p, objective);
    return {
      name: lexRow(objective),
      terms: scaledTerms(p, objective, scale),
      hi: scale * (f + tolerance * Math.max(Math.abs(f), LEX_EPSILON)),
    };
  });
}

/**
 * Factor that brings an objective's largest cost coefficient to 1 (A34).
 * HiGHS's tolerances are absolute, so an objective whose costs are all tiny
 * (O2's usage / map total is about 1e-5 per machine) would leave its
 * optimality and lock rows inside solver noise, and the plan would pick up
 * slivers of other routes. Scaling changes no optimum, only the units the LP
 * works in; stage values and duals stay in natural units.
 */
function objectiveScale(p: Problem, objective: ObjectiveId): number {
  let max = 0;
  for (const t of objectiveTerms(p, objective)) max = Math.max(max, Math.abs(t.coef));
  return max > 0 ? 1 / max : 1;
}

/** `objectiveTerms`, scaled by `objectiveScale` for the LP (A34). */
function scaledTerms(
  p: Problem,
  objective: ObjectiveId,
  scale = objectiveScale(p, objective),
): LpTerm[] {
  return objectiveTerms(p, objective).map((t) => ({ ...t, coef: t.coef * scale }));
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
    // O3 counts built machines: whole ones in whole-machines mode, and
    // always for heaters (A17), which burn full fuel per machine.
    const built = objective === 'machines' && (p.whole || r.heater === true);
    terms.push({ var: built ? machinesVar(r.id) : recipeVar(r.id), coef: c });
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
 * Embodied cost per 1/min of an unassigned import at `rate` (§3.3, A18): the
 * stack's values on a standalone plan that makes `rate`/min of it from the
 * map pool, with no imports, divided by `rate`. Cached per model and settings.
 */
async function embodiedCost(
  model: Model,
  request: SolveRequest,
  stack: readonly ObjectiveId[],
  item: string,
  rate: number,
  backend: LpBackend,
  options: LpOptions,
): Promise<ImportCost | Diagnostic> {
  const standalone: SolveRequest = {
    targets: [{ item, rate }],
    objectives: stack.filter((o) => o !== 'output'),
    ...(request.tolerance !== undefined ? { tolerance: request.tolerance } : {}),
    ...(request.scarcityWeights ? { scarcityWeights: request.scarcityWeights } : {}),
    ...(request.recipes ? { recipes: request.recipes } : {}),
  };
  if (!standalone.objectives!.length) return { item, rate, cost: {}, resourceTypes: [] };
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
          rate,
          cost: Object.fromEntries(
            r.stages
              .filter((s) => s.objective !== 'resourceTypes')
              .map((s) => [s.objective, s.value / rate]),
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
  const lp = buildLp(p, 'elastic', p.stack[0]!);
  // With heaters (A17) the elastic problem is a MILP: at HiGHS's default 1e-6
  // row tolerance it can "meet" a MIN_RATE demand with no heater built and
  // report no relaxation, so solve it tight first.
  let sol = lp.variables.some((v) => v.integer)
    ? await backend.solve(lp, { ...options, mipFeasibilityTolerance: TIGHT_MIP_FEASIBILITY })
    : await backend.solve(lp, options);
  if (sol.status !== 'optimal') sol = await backend.solve(lp, options);
  if (sol.status !== 'optimal' || !sol.values) return numerical(p.stack, stats, sol.rawStatus);
  const relaxations: Relaxation[] = [];
  for (const node of [...p.nodeCaps.keys()].sort()) {
    const amount = sol.values.get(nodeSlackVar(node)) ?? 0;
    if (amount > SLACK_TOL) relaxations.push({ kind: 'node', node, amount });
  }
  for (const item of [...p.resourceLimits.keys()].sort()) {
    const amount = sol.values.get(resourceSlackVar(item)) ?? 0;
    if (amount > SLACK_TOL) relaxations.push({ kind: 'resource', item, amount });
  }
  for (const item of [...p.importCaps.keys()].sort()) {
    if (!Number.isFinite(p.importCaps.get(item))) continue;
    const amount = sol.values.get(importSlackVar(item)) ?? 0;
    if (amount > SLACK_TOL) relaxations.push({ kind: 'import', item, amount });
  }
  for (const item of p.noSurplus) {
    const amount = sol.values.get(surplusSlackVar(item)) ?? 0;
    if (amount > SLACK_TOL) relaxations.push({ kind: 'surplus', item, amount });
  }
  const describe = (r: Relaxation): string => {
    if (r.kind === 'import') return `${fmt(r.amount)}/min more imported ${itemName(r.item)}`;
    if (r.kind === 'surplus')
      return `${fmt(r.amount)}/min of ${itemName(r.item)} left over, which "Avoid fluid byproducts" forbids`;
    if (r.kind === 'resource')
      return p.resourceLimits.get(r.item) === 0
        ? `${fmt(r.amount)}/min of ${itemName(r.item)}, which is turned off`
        : `${fmt(r.amount)}/min more ${itemName(r.item)} than its limit`;
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
          : 'Infeasible, but no node, resource, import or byproduct relaxation fixes it.',
        relaxations,
      },
    ],
  };
}

type LpMode = 'normal' | 'elastic' | 'capped';

/**
 * `normal`: the stage LP/MILP with its objective and lexicographic locks.
 * `elastic`: slack on node, resource and import caps, minimizing the relaxation
 * (whole-machine counts and O6 indicators are left out; heater counts stay
 * integer, A17, so the relaxation is what the real plan needs). `capped`: every variable capped at the sanity
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
  return { sense: 'min', objective, variables, constraints };
}

/**
 * A generator that also converts an item, like a turbine turning steam into
 * water or energized slug slime into spent slime: it outputs more than `mw`.
 */
const isConversionGenerator = (r: Recipe) =>
  r.kind === 'generator' && r.outputs.some((f) => f.item !== MW_ITEM_ID);

/** Cost per machine of each recipe under one objective (§3.3); recipes without a cost are left out. */
function objectiveCosts(
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
  const extracted = new Map<string, number>();
  let consumptionMW = 0;
  let generationMW = 0;
  const failures: string[] = [];
  for (const r of p.recipes) {
    const n = x.get(r.id)!;
    // Heaters (A17) and whole-machines mode: the solved integer count
    // (integral up to the MIP tolerance), checked against what runs.
    const counted = p.whole || r.heater === true;
    const m = counted ? val(machinesVar(r.id)) : 0;
    if (counted && n > m + BALANCE_TOL * Math.max(1, m))
      failures.push(`recipe ${r.id} runs ${n} machines but builds ${m}`);
    if (r.heater && Math.abs(m - Math.round(m)) > BALANCE_TOL)
      failures.push(`heater ${r.id} builds a fractional ${m} machines`);
    const whole = counted ? Math.round(m) : Math.ceil(n - 1e-6);
    if (n <= 0 && !(r.heater && whole > 0)) continue;
    // A heater burns fuel and emits exhaust for every machine it builds.
    const rate = (f: Flow) => f.rate * (f.heater ? whole : n);
    const inputs = r.inputs.map((f) => ({ item: f.item, rate: rate(f) }));
    const outputs = r.outputs.map((f) => ({ item: f.item, rate: rate(f) }));
    for (const f of outputs) add(produced, f.item, f.rate);
    for (const f of inputs) add(consumed, f.item, f.rate);
    if (r.node) add(nodeUse, r.node, p.whole ? whole : n);
    const e = p.extracts.get(r.id);
    if (e) add(extracted, e.item, e.rate * n);
    const power = r.powerMW * (r.heater ? whole : n);
    if (power >= 0) consumptionMW += power;
    else generationMW -= power;
    recipes.push({
      id: r.id,
      name: r.name,
      machine: r.machine,
      machines: r.heater ? whole : n,
      machinesCeil: whole,
      powerMW: power,
      ...(r.heater ? { boilerLoad: whole > 0 ? Math.min(1, n / whole) : 0 } : {}),
      inputs,
      outputs,
      ...(r.node ? { node: r.node } : {}),
    });
  }

  const items: ItemFlow[] = [];
  const scale = p.scaled.size ? val(OUTPUT_VAR) : 0;
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
    if (p.noSurplus.has(item) && flow.surplus > BALANCE_TOL * size)
      failures.push(`fluid ${item} left over (${flow.surplus}) against avoidFluidByproducts`);
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
  const extraction: ResourceExtraction[] = [];
  for (const [item, rate] of [...extracted].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const limit = p.resourceLimits.get(item);
    if (limit !== undefined && rate > limit + BALANCE_TOL * Math.max(1, limit))
      failures.push(`resource ${item} extraction ${rate} exceeds limit ${limit}`);
    extraction.push({ item, rate, ...(limit !== undefined ? { limit } : {}) });
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
    extraction,
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
  if (
    request.minBranch !== undefined &&
    (!Number.isFinite(request.minBranch) || request.minBranch < 0)
  )
    return bad(`Minimum branch must be 0 or more machines (got ${request.minBranch}).`);
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
  for (const c of request.importCosts ?? []) {
    if (!known.has(c.item)) return bad(`Unknown import-cost item "${c.item}".`);
    for (const [o, v] of Object.entries(c.cost))
      if (!Number.isFinite(v) || v < 0)
        return bad(`Import cost of ${c.item} under ${o} must be a finite number ≥ 0 (got ${v}).`);
  }
  for (const o of request.marginalCosts?.objectives ?? [])
    if (!OBJECTIVE_IDS.includes(o)) return bad(`Unknown marginal-cost objective "${String(o)}".`);
  for (const [r, w] of Object.entries(request.scarcityWeights ?? {}))
    if (!Number.isFinite(w) || w < 0)
      return bad(`Scarcity weight for ${r} must be a finite number ≥ 0 (got ${w}).`);
  const maxTier = request.recipes?.maxTier;
  if (maxTier !== undefined && !parseTier(maxTier))
    return bad(`Max tier must look like "3-2" (major-minor), got "${maxTier}".`);
  if (request.nodeBudget && request.nodeBudget !== 'pool')
    for (const [n, c] of Object.entries(request.nodeBudget))
      if (Number.isNaN(c) || c < 0) return bad(`Node budget for ${n} must be ≥ 0 (got ${c}).`);
  for (const [r, c] of Object.entries(request.resourceLimits ?? {})) {
    if (!known.has(r)) return bad(`Unknown resource "${r}".`);
    if (Number.isNaN(c) || c < 0) return bad(`Limit for ${r} must be ≥ 0 (got ${c}).`);
  }
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
    extraction: [],
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
