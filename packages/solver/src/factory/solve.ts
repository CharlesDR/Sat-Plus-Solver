import type { LpBackend, LpOptions } from '../lp/types';
import { failed, validate } from './checks';
import {
  DEFAULT_TOLERANCE,
  DUMPABLE_FLUIDS,
  MAX_TOLERANCE,
  MIN_BRANCH,
  MIN_FLOW,
  MIN_TOLERANCE,
  MINER_SUPPLY_COST_RATE,
} from './constants';
import { embodiedCost, solveCosted } from './costs';
import { filterMinerRoutes, minerSupplyItem } from './minerFluids';
import { closestFixes, prune, reachableFor } from './reachability';
import { filterRecipes } from './recipes';
import { extractionOf } from './resources';
import { byId, isConversionGenerator, objectiveCosts, type Problem, recipeVar } from './rows';
import { solveStack } from './stages';
import type { ObjectiveId, SolveRequest, SolveResult } from './types';
import type { Model, Recipe } from '@sps/data';

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
  const filtered = filterRecipes([...model.recipes].sort(byId), request.recipes);
  const { disabled } = filtered;
  // Miner fluid modules (A69): leave out the ones not allowed, and with the
  // fluid supplied from outside, route it through a supply item of its own.
  const outside = request.minerFluidSupply === 'outside';
  let enabled = filterMinerRoutes(filtered.enabled, request.minerFluids ?? 'any').map((r) =>
    outside && r.route?.fluid
      ? {
          ...r,
          inputs: r.inputs.map((f) =>
            f.item === r.route!.fluid ? { ...f, item: minerSupplyItem(f.item) } : f,
          ),
        }
      : r,
  );
  const fluidsOf = (rs: readonly Recipe[]) =>
    [...new Set(rs.flatMap((r) => (r.route?.fluid ? [r.route.fluid] : [])))].sort();
  const sourcesOf = (fluids: readonly string[]) =>
    [...importCaps.keys(), ...fluids.map(minerSupplyItem)].sort();
  // Each supplied fluid the plan may use is costed at a standalone plan's
  // cost per m³; a fluid no plan can make is left out, as it is when made here.
  // So is one only a breeding loop makes (A74), such as Slug Slime: a plan
  // that doesn't need a loop doesn't get one from outside either.
  const supply: Problem['supply'] = new Map();
  if (outside) {
    const all = fluidsOf(enabled);
    const plain = reachableFor(enabled, sourcesOf([]), []).have;
    const used = fluidsOf(
      prune(enabled, reachableFor(enabled, sourcesOf(all), wanted).have, wanted),
    ).filter((f) => plain.has(f));
    for (const fluid of used) {
      const c = await embodiedCost(
        model,
        { ...request, minerFluidSupply: 'local' },
        stack,
        fluid,
        MINER_SUPPLY_COST_RATE,
        backend,
        options,
      );
      if ('cost' in c) supply.set(minerSupplyItem(fluid), { fluid, cost: c.cost });
    }
    enabled = enabled.filter((r) => !r.route?.fluid || supply.has(minerSupplyItem(r.route.fluid)));
  }
  const sources = sourcesOf([...supply.values()].map((s) => s.fluid));
  const { have: available, bred } = reachableFor(enabled, sources, wanted);
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
  for (const item of [...supply.keys()]) if (!itemSet.has(item)) supply.delete(item);
  const noSurplus = new Set([
    ...(request.avoidFluidByproducts
      ? items.filter((i) => fluids.has(i) && !DUMPABLE_FLUIDS.includes(i))
      : []),
    // A supply is only ever drawn for the miners that use it.
    ...supply.keys(),
  ]);

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
    minFlow: request.minFlow ?? MIN_FLOW,
    simplicity: request.simplicity ?? false,
    farmCap: request.farmCap ?? 0,
    conversion: new Set(recipes.filter(isConversionGenerator).map((r) => recipeVar(r.id))),
    banned: new Set(),
    bred,
    recipes,
    items,
    demand,
    scaled,
    importCaps,
    nodeCaps,
    nodes,
    extracts,
    resourceLimits,
    supply,
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
export {
  DUMPABLE_FLUIDS,
  MIN_RATE,
  MIN_TOLERANCE,
  MAX_TOLERANCE,
  DEFAULT_TOLERANCE,
  LEX_EPSILON,
  MIN_BRANCH,
  MIN_FLOW,
  SIMPLICITY_CAP,
  FARM_CAP,
  MILP_TIME_LIMIT_SECONDS,
} from './constants';
export { costCacheEntries, seedCostCache } from './costs';
export type { CostCacheEntry } from './costs';
export { usageWeights } from './rows';
