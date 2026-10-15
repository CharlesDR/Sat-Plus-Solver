/** Result checks and result shapes (§3.5): `finish`, `validate` and failure results. Split from solve.ts (F1); behavior unchanged. */
import type { LpSolution } from '../lp/types';
import { BALANCE_TOL, MAX_TOLERANCE, MIN_RATE, MIN_TOLERANCE, NONNEG_TOL } from './constants';
import { planStarters } from './reachability';
import { parseTier } from './recipes';
import {
  byItem,
  importVar,
  machinesVar,
  OUTPUT_VAR,
  type Problem,
  recipeVar,
  supplyVar,
  surplusVar,
} from './rows';
import { pct } from './stages';
import {
  type Diagnostic,
  type ItemFlow,
  type ItemRate,
  type NodeUsage,
  OBJECTIVE_IDS,
  type ObjectiveId,
  type RecipeUsage,
  type ResourceExtraction,
  type SolveRequest,
  type SolveResult,
  type SolveStats,
} from './types';
import type { Flow, Model } from '@sps/data';

/** Post-processing and the mandatory solution checks. */
export function finish(
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
    let s = p.importCaps.has(item)
      ? val(importVar(item))
      : p.supply.has(item)
        ? val(supplyVar(item))
        : 0;
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
    if (p.supply.has(item)) continue;
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

  // Miner fluid supplied from outside (A69): checked on its own row, then
  // reported under the fluid itself, as an import of it.
  const minerSupply: ItemRate[] = [];
  if (p.supply.size) {
    const real = (item: string) => p.supply.get(item)?.fluid ?? item;
    for (const r of recipes) r.inputs = r.inputs.map((f) => ({ ...f, item: real(f.item) }));
    const merged = new Map<string, ItemFlow>();
    for (const f of items) {
      const item = real(f.item);
      const m = merged.get(item);
      if (!m) merged.set(item, { ...f, item });
      else
        for (const k of ['produced', 'consumed', 'imported', 'surplus', 'demand'] as const)
          m[k] += f[k];
    }
    items.splice(0, items.length, ...[...merged.values()].sort(byItem));
    for (const [item, rate] of [...imported]) {
      if (!p.supply.has(item)) continue;
      imported.delete(item);
      minerSupply.push({ item: real(item), rate });
      imported.set(real(item), (imported.get(real(item)) ?? 0) + rate);
    }
  }

  // A loop the plan runs needs its starter brought once (A74).
  const starters = planStarters(recipes, imported.keys(), p.bred);
  return {
    status: 'ok',
    objective: p.stack[0]!,
    objectives: [...p.stack],
    stages: [],
    ...(p.scaled.size ? { outputScale: scale } : {}),
    ...(starters.length ? { starters } : {}),
    recipes,
    items,
    imports: toRates(imported),
    ...(minerSupply.length ? { minerSupply: minerSupply.sort(byItem) } : {}),
    surplus: toRates(surplus),
    nodes,
    extraction,
    power: { consumptionMW, generationMW, netMW: consumptionMW - generationMW },
    diagnostics,
    stats,
  };
}

export function validate(
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
  if (
    request.farmCap !== undefined &&
    (!Number.isFinite(request.farmCap) || request.farmCap < 0 || request.farmCap >= 1)
  )
    return bad(`Farm cap must be at least 0% and below 100% (got ${request.farmCap}).`);
  if (request.minFlow !== undefined && (!Number.isFinite(request.minFlow) || request.minFlow < 0))
    return bad(`Minimum flow must be 0 or more per minute (got ${request.minFlow}).`);
  if (request.minerFluids !== undefined && !['any', 'water', 'none'].includes(request.minerFluids))
    return bad(`Unknown miner fluid setting "${String(request.minerFluids)}".`);
  if (
    request.minerFluidSupply !== undefined &&
    !['local', 'outside'].includes(request.minerFluidSupply)
  )
    return bad(`Unknown miner fluid supply "${String(request.minerFluidSupply)}".`);
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

export const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export function emptyResult(
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

export function failed(
  status: SolveResult['status'],
  stack: readonly ObjectiveId[],
  diagnostics: Diagnostic[],
): SolveResult {
  return { ...emptyResult(status, stack), diagnostics };
}

export const numerical = (
  stack: readonly ObjectiveId[],
  stats: SolveStats,
  raw: string,
): SolveResult => ({
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
