/** The lexicographic stage loop: stack solves, elastic retries, polish and tidy (§3.3, §3.5). Split from solve.ts (F1); behavior unchanged. */
import type { LpBackend, LpConstraint, LpModel, LpOptions, LpSolution, LpTerm } from '../lp/types';
import { emptyResult, finish, fmt, numerical } from './checks';
import {
  CONVERSION_TIDY_WEIGHT,
  LEX_EPSILON,
  MAX_TOLERANCE,
  MILP_TIME_LIMIT_SECONDS,
  POLISH_SLACK,
  SANITY_CAP,
  SLACK_TOL,
  TIGHT_MIP_FEASIBILITY,
} from './constants';
import { pruneBranches, pruneFlows, simplify } from './prunes';
import {
  balanceRow,
  buildLp,
  importSlackVar,
  lexRow,
  nodeSlackVar,
  objectiveCosts,
  objectiveScale,
  objectiveTerms,
  type Problem,
  recipeVar,
  resourceSlackVar,
  scaledTerms,
  stageValue,
  surplusSlackVar,
} from './rows';
import type {
  Diagnostic,
  ImportCost,
  ObjectiveId,
  Relaxation,
  SolveResult,
  SolveStats,
  StageResult,
} from './types';

/**
 * The lexicographic driver (§3.3): solves each objective of the stack in
 * order, holding every earlier one at `f_k ≤ f_k* + tol·max(|f_k*|, ε)`. A
 * later stage that fails is retried once at 10× tolerance, with a warning (§3.5).
 */
export async function solveStack(
  p: Problem,
  backend: LpBackend,
  options: LpOptions,
  itemName: (id: string) => string,
  diagnostics: Diagnostic[],
): Promise<SolveResult> {
  const before = [...diagnostics];
  const plan = await solveLex(p, backend, options, itemName, diagnostics);
  // Banned recipes are left out of the LP altogether: the re-solves keep to
  // the plan's own recipes, so their LPs are small.
  const without = (banned: ReadonlySet<string>): Problem => {
    const kept = (id: string) => !banned.has(recipeVar(id));
    return {
      ...p,
      recipes: p.recipes.filter((r) => kept(r.id)),
      resources: new Map(
        [...p.resources].map(([k, e]) => [k, { ...e, recipes: e.recipes.filter(kept) }]),
      ),
      banned,
      turbineCaps: new Map(),
    };
  };
  const resolve = (banned: ReadonlySet<string>) =>
    solveLex(without(banned), backend, options, itemName, [...before]);
  const bound = (banned: ReadonlySet<string>) => firstStageBound(without(banned), backend, options);
  const simple = await simplify(p, plan, resolve, bound);
  const best = await pruneFlows(p, simple, plan, resolve, bound);
  if (best === plan) return plan;
  // Recipes the plan ran that it no longer does.
  const runs = new Set(best.recipes.map((u) => u.id));
  const dropped = plan.recipes.map((u) => u.id).filter((id) => !runs.has(id));
  const pruned = [...new Set([...(best.stats.pruned ?? []), ...dropped])].sort();
  // The size of the model the plan was first solved on, not of the re-solves.
  const { recipes, columns, rows } = plan.stats;
  return {
    ...best,
    stats: { ...best.stats, recipes, columns, rows, ...(pruned.length ? { pruned } : {}) },
  };
}

/**
 * The first stage's optimum of the LP relaxation, a bound on what the stack
 * can reach (no worse than the plan's optimum): undefined when it is
 * infeasible, NaN when it gives no bound (O6, whose indicators round).
 */
async function firstStageBound(
  p: Problem,
  backend: LpBackend,
  options: LpOptions,
): Promise<number | undefined> {
  const first = p.stack[0]!;
  if (first === 'resourceTypes') return Number.NaN;
  const lp = buildLp(p, 'normal', first);
  const s = await backend.solve(
    { ...lp, variables: lp.variables.map(({ integer: _, ...v }) => v) },
    options,
  );
  if (s.status === 'infeasible') return undefined;
  if (s.status !== 'optimal' || !s.values) return Number.NaN;
  return stageValue(p, first, s.values);
}

/** One lexicographic solve of the stack, then the prune pass (A34) and the checks. */
async function solveLex(
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
        return tidy(lp, await backend.solve(lp, options), terms, 0, backend, options, p.conversion);
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
      const polished = await polish(lp, mip, integer, terms, backend, milpOptions, p.conversion);
      if (polished) return polished;
      // The machine counts don't hold up at LP precision: the MILP met a tiny
      // demand within its feasibility tolerance. Solve it again, tighter.
      const tight: LpOptions = { ...milpOptions, mipFeasibilityTolerance: TIGHT_MIP_FEASIBILITY };
      const again = await backend.solve(lp, start ? { ...tight, start } : tight);
      return (await polish(lp, again, integer, terms, backend, milpOptions, p.conversion)) ?? again;
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
 * Marginal cost per 1/min of each requested item the plan handles (A18): per
 * objective, the dual of the item's balance row in an LP of that objective
 * alone, without the tie-break regularizer, with every integer count (heaters
 * always, whole machines, O6 indicators) fixed at the plan's value. A MILP has
 * no duals; fixing the counts keeps a whole heater's fuel on this factory.
 * An objective whose LP fails is left out, so the consumer falls back to a
 * standalone plan for it.
 */
export async function marginalCosts(
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
  conversion: ReadonlySet<string> = new Set(),
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
    values: (
      await tidy({ ...lp, variables }, fixed, stage, POLISH_SLACK, backend, options, conversion)
    ).values!,
  };
}

/**
 * Holds a solved stage objective at its value and minimizes Σx, so each
 * recipe runs only as hard as the plan needs. The 1e-9 regularizer alone is
 * below the solver's tolerances, so an LP plan could otherwise process a free
 * capped import into surplus product, and a pull link would draw that excess
 * from its producer (R7). Conversion generators (`conversion`, C1 in A73)
 * weigh CONVERSION_TIDY_WEIGHT instead of 1: a turbine that turns dumped
 * steam into water the plan uses saves more than it costs at any rate, so
 * it always runs, while one whose water would only be left over never does.
 * Keeps the solution's status; returns it as is when it has no optimal plan
 * or the tidy LP fails.
 */
export async function tidy(
  lp: LpModel,
  sol: LpSolution,
  stage: LpTerm[],
  slack: number,
  backend: LpBackend,
  options: LpOptions,
  conversion: ReadonlySet<string> = new Set(),
): Promise<LpSolution> {
  if (sol.status !== 'optimal' || !sol.values) return sol;
  const value = stage.reduce((sum, t) => sum + t.coef * (sol.values!.get(t.var) ?? 0), 0);
  const tidied = await backend.solve(
    {
      ...lp,
      objective: lp.variables
        .filter((v) => v.name.startsWith('recipe:'))
        .map((v) => ({
          var: v.name,
          coef: conversion.has(v.name) ? CONVERSION_TIDY_WEIGHT : 1,
        })),
      constraints: [
        ...lp.constraints,
        { name: 'polish', terms: stage, hi: value + slack * Math.max(1, Math.abs(value)) },
      ],
    },
    options,
  );
  return tidied.status === 'optimal' && tidied.values ? { ...sol, values: tidied.values } : sol;
}

export const usable = (s: LpSolution) =>
  s.values !== undefined &&
  (s.status === 'optimal' || s.status === 'time-limit' || s.status === 'iteration-limit');

export const pct = (f: number) => `${Math.round(f * 1e6) / 1e4}%`;

/** Lexicographic rows holding each solved stage within tolerance of its optimum (min form). */
export function lexLocks(
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
