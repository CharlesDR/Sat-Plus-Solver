/** Plan prunes: tiny branches (A34), tiny flows (A68), simplicity and byproduct farms (A73, A86). Split from solve.ts (F1); behavior unchanged. */
import type { LpBackend, LpModel, LpOptions, LpSolution } from '../lp/types';
import {
  LEX_EPSILON,
  MAX_FARM_SOLVES,
  MAX_FLOW_COST,
  MAX_FLOW_SOLVES,
  MAX_PRUNE_ATTEMPTS,
  MAX_SIMPLIFY_BOUNDS,
  MAX_SIMPLIFY_MISSES,
  MAX_SIMPLIFY_SOLVES,
  NOISE,
  SIMPLICITY_CAP,
} from './constants';
import { minerSupplyItem } from './minerFluids';
import { producible, reachableFor } from './reachability';
import {
  buildLp,
  importVar,
  machinesVar,
  type Problem,
  recipeVar,
  scaledTerms,
  supplyVar,
  surplusVar,
} from './rows';
import { lexLocks, tidy, usable } from './stages';
import type { ObjectiveId, RecipeUsage, SolveResult } from './types';
import { MW_ITEM_ID, type Recipe } from '@sps/data';

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
 * count at 0), so every re-solve is an LP. The plan kept is tidied once at
 * the end, not after every attempt (T1). Deterministic: candidates go in id
 * order.
 */
export async function pruneBranches(
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
  /** The LP of the last drop kept, which the kept plan is tidied on. */
  let kept: LpModel | undefined;
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
    kept = fixed;
    return { ...sol, values: s.values };
  };
  while (attempts < MAX_PRUNE_ATTEMPTS) {
    const support = p.recipes.map((r) => r.id).filter((id) => run(sol, id) > 0);
    // Conversion generators (C1, A73) stay: tidy runs them only on steam that would be dumped.
    const small = support.filter(
      (id) => run(sol, id) < p.minBranch && !needed.has(id) && !p.conversion.has(recipeVar(id)),
    );
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
  // Tidied once, on the plan kept (T1): an attempt only tests feasibility.
  if (kept)
    sol = {
      ...sol,
      values: (await tidy(kept, sol, terms, 0, backend, options, p.conversion)).values!,
    };
  return { sol, banned: [...banned].sort() };
}

/**
 * The flow prune (A68). Slivers the prune pass (A34) must keep, because the
 * earlier stages' optima lean on them, still show as tiny flows: a miner
 * running 0.00007 machines for 0.0005/min of acid, or 0.0009/min of steam
 * left over. Every recipe with an input below `minFlow` per minute, or all
 * of its outputs (a tiny byproduct alone is its surplus's to answer for),
 * and every surplus or import below it, is held at 0 and the whole stack
 * solved again, so each stage gets a fresh optimum without them, as long as
 * no stage ends up more than MAX_FLOW_COST (1%) worse than `ref`, the first
 * solve's plan (a cap it shares with the simplicity pass, A73). As in
 * the prune pass, the re-solve keeps to the plan's own recipes, so it doesn't
 * spend the room on new slivers (and its LPs stay small): all of them
 * together are tried first, then each alone in order (recipes by id, then
 * surpluses, then imports). The LP relaxation of the first stage turns most
 * costly drops away with one LP. A drop whose plan fails, adds a warning,
 * costs more than that, or has no fewer tiny flows (a tiny surplus traded for
 * a tiny recipe consuming it) is undone, so a flow the plan needs (a target
 * below `minFlow`) stays. Repeats on the new plan, at most MAX_FLOW_SOLVES
 * attempts, starting from the simplicity pass's plan and drops. Deterministic.
 */
export async function pruneFlows(
  p: Problem,
  start: Pruned,
  ref: SolveResult,
  resolve: (banned: ReadonlySet<string>) => Promise<SolveResult>,
  bound: (banned: ReadonlySet<string>) => Promise<number | undefined>,
): Promise<SolveResult> {
  const plan = start.plan;
  if (!(p.minFlow > 0) || plan.status !== 'ok') return plan;
  /** Variables held at 0 in `best`; recipes always with their machine counts. */
  let banned = new Set<string>(start.banned);
  const needed = new Set<string>();
  const machines = new Map(p.recipes.map((r) => [recipeVar(r.id), machinesVar(r.id)]));
  const tinies = (r: SolveResult) => tinyFlows(p, r);
  const within = (k: number, value: number) => withinCost(ref, MAX_FLOW_COST, k, value);
  let solves = 0;
  let best = plan;
  /**
   * Re-solves with `drop` banned too, and every recipe `best` doesn't run;
   * undefined when the plan fails, warns more than before, costs too much,
   * or has as many tiny flows as `best`.
   */
  const attempt = async (drop: readonly string[]) => {
    solves++;
    const used = new Set(best.recipes.map((u) => recipeVar(u.id)));
    const unused = [...machines.keys()].filter((v) => !used.has(v));
    const vars = new Set(
      [...banned, ...drop, ...unused].flatMap((v) =>
        machines.has(v) ? [v, machines.get(v)!] : [v],
      ),
    );
    // The first stage's relaxation rules most drops out with one LP.
    const first = await bound(vars);
    if (first === undefined || (!Number.isNaN(first) && !within(0, first))) return undefined;
    const r = await resolve(vars);
    if (r.status !== 'ok' || r.diagnostics.length > plan.diagnostics.length) return undefined;
    if (!r.stages.every((st, k) => within(k, st.value))) return undefined;
    // Trading a tiny surplus for a tiny recipe that consumes it is no gain.
    if (tinies(r).length >= tinies(best).length) return undefined;
    banned = vars;
    best = r;
    return r;
  };
  while (solves < MAX_FLOW_SOLVES) {
    const candidates = tinies(best).filter((v) => !needed.has(v));
    if (!candidates.length) break;
    if (await attempt(candidates)) continue;
    if (candidates.length === 1) {
      needed.add(candidates[0]!);
      continue;
    }
    for (const v of candidates) {
      if (solves >= MAX_FLOW_SOLVES) break;
      // The plan changed: the next round recomputes its tiny flows.
      if (await attempt([v])) break;
      needed.add(v);
    }
  }
  return best;
}

/** A plan's flows below `minFlow` (A68), as the LP variables that carry them. */
function tinyFlows(p: Problem, r: SolveResult): string[] {
  const tiny = (rate: number) => rate > 0 && rate < p.minFlow;
  return [
    ...r.recipes
      .filter((u) => u.inputs.some((f) => tiny(f.rate)) || u.outputs.every((f) => tiny(f.rate)))
      .map((u) => recipeVar(u.id)),
    ...r.surplus.filter((f) => tiny(f.rate)).map((f) => surplusVar(f.item)),
    ...r.imports
      .filter((f) => {
        const supplied = r.minerSupply?.find((m) => m.item === f.item)?.rate ?? 0;
        return p.importCaps.has(f.item) && tiny(f.rate - supplied);
      })
      .map((f) => importVar(f.item)),
    ...(r.minerSupply ?? [])
      .filter((f) => tiny(f.rate))
      .map((f) => supplyVar(minerSupplyItem(f.item))),
  ];
}

/** A pruned plan and the LP variables it holds at 0. */
interface Pruned {
  plan: SolveResult;
  banned: ReadonlySet<string>;
}

/** Stage `k`'s `value` within `cap` (relative) of `ref`'s, in the objective's sense. */
function withinCost(ref: SolveResult, cap: number, k: number, value: number): boolean {
  const was = ref.stages[k]!.value;
  const room = cap * Math.max(Math.abs(was), LEX_EPSILON);
  return ref.stages[k]!.objective === 'output' ? value >= was - room : value <= was + room;
}

/**
 * The simplicity pass (A73), before the flow prune (A68). Every drop holds the
 * recipe (and its machine count) at 0 and solves the whole stack again, so
 * the plan returned is always a fresh solution that `finish()` has checked;
 * nothing is zeroed afterwards. Conversion generators are never dropped (C1).
 *
 * 1. Rounding error, always: recipes below NOISE of the plan's largest go
 *    when the plan stays within `tolerance` of itself without them.
 * 2. With `simplicity`, slivers (C2): recipes below `minBranch` machines,
 *    scaled down by the plan's largest recipe when it runs under one machine,
 *    so a small target keeps its small steps. All of them together first, on
 *    any recipe (a sliver may stand in for a route the plan doesn't run yet);
 *    then each alone, smallest first, on the plan's own recipes and then on
 *    any recipe. A miner is never dropped alone on any recipe: it would only
 *    come back as another miner of the same ore.
 * 3. With `simplicity`, fewest steps (UX-1A): each remaining recipe alone,
 *    smallest first, on the plan's own recipes.
 *
 * 4. With `simplicity` and `farmCap`, byproduct farms (A86): each with the
 *    recipes that only feed it, on every recipe, within `farmCap` of the
 *    first solve's plan; then steps 2 and 3 again against the farm-free
 *    plan. The farm stays unless that ends with fewer recipes.
 *
 * Steps 2 and 3 may cost up to SIMPLICITY_CAP on each objective against the
 * first solve's plan; the flow prune that follows shares the same cap. A drop
 * that leaves a target unproducible is ruled out without an LP, and the rest
 * are checked first against the first stage's LP relaxation. A drop is kept
 * only when the re-solved plan is ok, warns no more, stays within the cap and
 * is simpler: fewer recipes, or as many with fewer slivers. At most
 * MAX_SIMPLIFY_SOLVES re-solves and MAX_SIMPLIFY_BOUNDS bounds, and the pass
 * stops after MAX_SIMPLIFY_MISSES rejected re-solves in a row. Returns the
 * plan and the variables its drops hold at 0. Deterministic.
 */
export async function simplify(
  p: Problem,
  plan: SolveResult,
  resolve: (banned: ReadonlySet<string>) => Promise<SolveResult>,
  bound: (banned: ReadonlySet<string>) => Promise<number | undefined>,
): Promise<Pruned> {
  let best = plan;
  /** Variables of the recipes dropped so far, with their machine counts. */
  let dropped: ReadonlySet<string> = new Set<string>();
  if (best.status !== 'ok') return { plan, banned: dropped };
  let solves = 0;
  let bounds = 0;
  /** Rejected re-solves since the last kept one. */
  let misses = 0;
  const wanted = [...new Set([...p.demand.keys(), ...p.scaled.keys()])];
  const extraction = new Set(p.recipes.filter((r) => r.kind === 'extraction').map((r) => r.id));
  const sources = [...p.importCaps.keys(), ...p.supply.keys()];
  const largest = (r: SolveResult) => Math.max(0, ...r.recipes.map((u) => u.machines));
  /** Droppable recipes of `r` below `threshold` machines, smallest first, then by id. */
  const below = (r: SolveResult, threshold: number) =>
    r.recipes
      .filter((u) => u.machines < threshold && !p.conversion.has(recipeVar(u.id)))
      .sort((a, b) => a.machines - b.machines || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((u) => u.id);
  const slivers = (r: SolveResult) => below(r, p.minBranch * Math.min(1, largest(r))).length;
  /** Re-solves without `ids`; true (and `best` replaced) when it is no worse than `ref` by `cap` and simpler. */
  const attempt = async (
    ids: readonly string[],
    ref: SolveResult,
    cap: number,
    open = false,
    farm = false,
  ) => {
    // Farm drops have their own limit (MAX_FARM_SOLVES a round).
    if (!farm && (solves >= MAX_SIMPLIFY_SOLVES || bounds >= MAX_SIMPLIFY_BOUNDS)) return false;
    if (!farm && misses >= MAX_SIMPLIFY_MISSES) return false;
    // A miner dropped on its own comes back as another miner of the same ore.
    if (open && ids.every((id) => extraction.has(id))) return false;
    const runs = new Set(best.recipes.map((u) => u.id));
    // Open: also any recipe making something the plan handles (another
    // route to it), which keeps the LPs small.
    const handled = new Set(best.items.map((f) => f.item));
    const near = (r: Recipe) => open && r.outputs.some((f) => handled.has(f.item));
    // A farm drop re-solves on every recipe: its replacement may start from new ore.
    const unused = farm
      ? []
      : p.recipes.filter((r) => !runs.has(r.id) && !near(r)).map((r) => r.id);
    const drop = ids.flatMap((id) => [recipeVar(id), machinesVar(id)]);
    const vars = new Set([
      ...dropped,
      ...drop,
      ...unused.flatMap((id) => [recipeVar(id), machinesVar(id)]),
    ]);
    // A drop that leaves a target with no way to be made needs no LP to rule out.
    const left = p.recipes.filter((r) => !vars.has(recipeVar(r.id)));
    // Loops count only when the plan already needed one (A74).
    const have = p.bred.size ? producible(left, sources) : reachableFor(left, sources, []).have;
    if (wanted.some((i) => !have.has(i))) return false;
    if (!farm) bounds++;
    const first = await bound(vars);
    if (first === undefined || (!Number.isNaN(first) && !withinCost(ref, cap, 0, first)))
      return false;
    if (!farm) solves++;
    misses++;
    const r = await resolve(vars);
    if (r.status !== 'ok' || r.diagnostics.length > best.diagnostics.length) return false;
    if (!r.stages.every((st, k) => withinCost(ref, cap, k, st.value))) return false;
    // A farm-free plan is simplified by the steps that follow, so it need not be simpler yet.
    const n = r.recipes.length;
    const was = best.recipes.length;
    if (!farm && (n > was || (n === was && slivers(r) >= slivers(best)))) return false;
    misses = 0;
    dropped = new Set([...dropped, ...drop]);
    best = r;
    return true;
  };

  const noise = below(best, NOISE * largest(best));
  if (noise.length) await attempt(noise, best, p.tolerance);

  // Steps 2 and 3 hold their cap against `base`: the first solve's plan, or
  // the farm-free plan once a farm has gone (4).
  let base = plan;
  const kept = new Set<string>();
  /** Drops the plan's byproduct farms it can do without; true when one went. */
  const dropFarms = async () => {
    let any = false;
    for (let tries = 0; tries < MAX_FARM_SOLVES; tries++) {
      const farm = byproductFarms(best, wanted, extraction, p.conversion).find(
        (f) => !kept.has(f[0]!),
      );
      if (!farm) break;
      if (await attempt(farm, plan, p.farmCap, true, true)) {
        base = best;
        any = true;
      } else kept.add(farm[0]!);
    }
    // Farm misses must not starve the steps.
    misses = 0;
    return any;
  };
  /** Slivers, then fewest steps (2 and 3). */
  const steps = async () => {
    const needed = new Set<string>();
    let first = true;
    for (;;) {
      const small = below(best, p.minBranch * Math.min(1, largest(best))).filter(
        (id) => !needed.has(id),
      );
      if (!small.length || solves >= MAX_SIMPLIFY_SOLVES) break;
      // All of them together, once: after a failure, smaller sets rarely do better.
      if (first && (await attempt(small, base, SIMPLICITY_CAP, true))) continue;
      first = false;
      let changed = false;
      for (const id of small) {
        // On the plan's own recipes first (a small LP), then on any recipe.
        if (
          (await attempt([id], base, SIMPLICITY_CAP)) ||
          (await attempt([id], base, SIMPLICITY_CAP, true))
        ) {
          changed = true;
          break;
        }
        needed.add(id);
      }
      if (!changed) break;
    }
    for (;;) {
      const ids = below(best, Infinity).filter((id) => !needed.has(id));
      let changed = false;
      for (const id of ids) {
        if (await attempt([id], base, SIMPLICITY_CAP)) {
          changed = true;
          break;
        }
        needed.add(id);
      }
      if (!changed) break;
    }
  };

  if (!p.simplicity) return { plan: best, banned: dropped };
  await steps();
  if (p.farmCap > 0) {
    const before = { best, dropped };
    if (await dropFarms()) {
      await steps();
      // The farm-free plan, simplified again, must be simpler; else the farm stays.
      if (best.recipes.length >= before.best.recipes.length) ({ best, dropped } = before);
    }
  }
  return { plan: best, banned: dropped };
}

/**
 * Byproduct farms of a plan (A86), by farm recipe id: each is the farm first,
 * then the recipes that only feed it. A farm is a recipe whose main (first)
 * output nobody in the plan consumes and nothing wants, so it all goes to
 * surplus. A feeder makes something only the farm's chain consumes and
 * nothing wanted. Miners and conversion generators are never part of one.
 */
function byproductFarms(
  plan: SolveResult,
  wanted: readonly string[],
  extraction: ReadonlySet<string>,
  conversion: ReadonlySet<string>,
): string[][] {
  const want = new Set(wanted);
  const flow = new Map(plan.items.map((f) => [f.item, f]));
  const consumers = new Map<string, Set<string>>();
  for (const u of plan.recipes)
    for (const f of u.inputs) {
      if (!(f.rate > 0)) continue;
      const c = consumers.get(f.item) ?? new Set<string>();
      c.add(u.id);
      consumers.set(f.item, c);
    }
  const free = (u: RecipeUsage) => !extraction.has(u.id) && !conversion.has(recipeVar(u.id));
  const farms: string[][] = [];
  for (const u of plan.recipes) {
    const [main, ...rest] = u.outputs.filter((f) => f.item !== MW_ITEM_ID);
    if (!main || !free(u) || want.has(main.item) || consumers.has(main.item)) continue;
    // It runs for a byproduct the plan uses; a recipe with nothing else used is disposal.
    if (!rest.some((f) => consumers.has(f.item) || want.has(f.item))) continue;
    if (!((flow.get(main.item)?.surplus ?? 0) > 0)) continue;
    const chain = new Set([u.id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const g of plan.recipes) {
        if (chain.has(g.id) || !free(g)) continue;
        const outs = g.outputs.filter((f) => f.item !== MW_ITEM_ID);
        if (outs.some((f) => want.has(f.item))) continue;
        const used = outs.filter((f) => consumers.has(f.item));
        if (!used.length) continue;
        if (used.every((f) => [...consumers.get(f.item)!].every((c) => chain.has(c)))) {
          chain.add(g.id);
          grew = true;
        }
      }
    }
    farms.push([...chain]);
  }
  return farms;
}
