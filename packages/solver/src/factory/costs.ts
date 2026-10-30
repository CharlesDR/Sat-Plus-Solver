/** Embodied import costs (A31): costed re-solves and the per-model cost cache. Split from solve.ts (F1); behavior unchanged. */
import type { LpBackend, LpOptions } from '../lp/types';
import { MAX_COST_ROUNDS, MIN_RATE } from './constants';
import { byItem, type Problem } from './rows';
import { solve } from './solve';
import { solveStack } from './stages';
import type { Diagnostic, ImportCost, ObjectiveId, SolveRequest, SolveResult } from './types';
import type { Model } from '@sps/data';

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
export async function solveCosted(
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
    // Rates below MIN_RATE are solver noise, and below what a standalone plan
    // can target. Only the paid part is costed (A99).
    for (const i of plan.imports) {
      const paid = i.rate - (base.importFree.get(i.item) ?? 0);
      if (rates.has(i.item) && paid >= MIN_RATE) rates.set(i.item, paid);
    }
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
  const recosted = seen.map(({ plan, solvedWith, own }) =>
    recost(plan, solvedWith, own, base.importFree),
  );
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
  free: ReadonlyMap<string, number>,
): SolveResult {
  const paid = (i: { item: string; rate: number }) => Math.max(0, i.rate - (free.get(i.item) ?? 0));
  const shift = (o: ObjectiveId) =>
    plan.imports.reduce(
      (sum, i) =>
        sum + ((own.get(i.item)?.cost[o] ?? 0) - (solvedWith.get(i.item)?.cost[o] ?? 0)) * paid(i),
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

const embodiedCache = new WeakMap<Model, Map<string, ImportCost | Diagnostic>>();

/** One embodied-cost cache entry: the standalone request's key and its cost. */
export type CostCacheEntry = [key: string, cost: ImportCost | Diagnostic];

/**
 * The embodied-cost cache for `model` (A90), oldest first, so the app can
 * keep it across reloads. Entries are plain data.
 */
export function costCacheEntries(model: Model): CostCacheEntry[] {
  return [...(embodiedCache.get(model) ?? [])];
}

/**
 * Seeds the embodied-cost cache for `model` with entries saved by
 * `costCacheEntries` for the same model data (A90). Entries already cached win.
 */
export function seedCostCache(model: Model, entries: readonly CostCacheEntry[]): void {
  let cache = embodiedCache.get(model);
  if (!cache) embodiedCache.set(model, (cache = new Map()));
  for (const [key, cost] of entries) if (!cache.has(key)) cache.set(key, cost);
}

/**
 * Embodied cost per 1/min of an unassigned import at `rate` (§3.3, A18): the
 * stack's values on a standalone plan that makes `rate`/min of it from the
 * map pool, with no imports, divided by `rate`. Cached per model and settings.
 */
export async function embodiedCost(
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
    ...(request.minerFluids ? { minerFluids: request.minerFluids } : {}),
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
