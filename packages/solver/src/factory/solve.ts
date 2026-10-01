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
import type {
  Diagnostic,
  ItemFlow,
  ItemRate,
  NodeUsage,
  ObjectiveId,
  Relaxation,
  RecipeUsage,
  SolveRequest,
  SolveResult,
  SolveStats,
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

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byItem = <T extends { item: string }>(a: T, b: T) =>
  a.item < b.item ? -1 : a.item > b.item ? 1 : 0;

interface Problem {
  model: Model;
  objective: ObjectiveId;
  recipes: Recipe[];
  /** Balance-row items, sorted. */
  items: string[];
  demand: Map<string, number>;
  /** Imports with a positive cap, on balance-row items only. */
  importCaps: Map<string, number>;
  /** Caps of the node classes the kept recipes use. */
  nodeCaps: Map<string, number>;
  nodes: Map<string, ResourceNode>;
  /** Objective cost per machine of each kept recipe (before the regularizer). */
  cost: Map<string, number>;
}

/**
 * Solves one factory (docs/ARCHITECTURE.md §3) under O1 or O2: filters and
 * prunes recipes, builds the LP (item balance, node capacity, imports,
 * surplus), handles every backend status with the §3.5 diagnostics, and checks
 * the plan before returning it. Deterministic: identical input gives identical output.
 */
export async function solve(
  model: Model,
  request: SolveRequest,
  backend: LpBackend,
  options: LpOptions = {},
): Promise<SolveResult> {
  const objective = request.objective ?? 'resources';
  const invalid = validate(model, request);
  if (invalid) return failed('error', objective, [invalid]);

  // Demand per item: targets plus world demand.
  const demand = new Map<string, number>();
  for (const d of [...request.targets, ...(request.demand ?? [])])
    if (d.rate > 0) demand.set(d.item, (demand.get(d.item) ?? 0) + d.rate);

  const importCaps = new Map<string, number>();
  for (const i of request.imports ?? [])
    if (i.cap > 0) importCaps.set(i.item, (importCaps.get(i.item) ?? 0) + i.cap);

  // Recipe filter, then reachability (§3.5) and pruning.
  const exclude = new Set(request.recipes?.exclude ?? []);
  const alternates = request.recipes?.alternates ?? true;
  const enabled: Recipe[] = [];
  const disabled: Recipe[] = [];
  for (const r of [...model.recipes].sort(byId))
    (exclude.has(r.id) || (!alternates && r.alternate) ? disabled : enabled).push(r);
  const sources = [...importCaps.keys()].sort();
  const available = producible(enabled, sources);
  const unreachable = [...demand.keys()].filter((i) => !available.has(i)).sort();
  const names = new Map(model.items.map((i) => [i.id, i.name]));
  const itemName = (id: string) => names.get(id) ?? id;
  if (unreachable.length) {
    return failed(
      'unreachable',
      objective,
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
  const recipes = prune(enabled, available, demand.keys());

  // Items, node caps and objective costs.
  const itemSet = new Set(demand.keys());
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
  const cost = objectiveCosts(model, objective, request.scarcityWeights, recipes, nodes);
  const problem: Problem = {
    model,
    objective,
    recipes,
    items,
    demand,
    importCaps,
    nodeCaps,
    nodes,
    cost,
  };

  const lp = buildLp(problem, 'normal');
  const stats: SolveStats = {
    recipes: recipes.length,
    columns: lp.variables.length,
    rows: lp.constraints.length,
  };
  const sol = await backend.solve(lp, options);
  return interpret(problem, sol, stats, backend, options, itemName);
}

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
      return finish(p, sol, stats, []);
    case 'time-limit':
    case 'iteration-limit': {
      if (!sol.values) {
        return {
          ...emptyResult('error', p.objective, stats),
          diagnostics: [
            {
              code: 'time-limit',
              severity: 'warning',
              message: `The solver stopped (${sol.rawStatus}) before finding any plan.`,
            },
          ],
        };
      }
      return finish(p, sol, stats, [
        {
          code: 'time-limit',
          severity: 'warning',
          message: `The solver stopped (${sol.rawStatus}); this is the best plan found and may not be optimal.`,
        },
      ]);
    }
    case 'infeasible':
      return elastic(p, stats, backend, options, itemName);
    case 'unbounded':
    case 'infeasible-or-unbounded': {
      // Re-solve with every variable capped: a solution names the unbounded
      // direction; infeasibility means the original LP was infeasible.
      const capped = await backend.solve(buildLp(p, 'capped'), options);
      if (capped.status === 'optimal' && capped.values) {
        const directions = [...capped.values]
          .filter(([, v]) => v >= SANITY_CAP * (1 - 1e-6))
          .map(([k]) => k)
          .sort();
        return {
          ...emptyResult('unbounded', p.objective, stats),
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
      return numerical(p.objective, stats, capped.rawStatus);
    }
    case 'error':
      return numerical(p.objective, stats, sol.rawStatus);
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
  const sol = await backend.solve(buildLp(p, 'elastic'), options);
  if (sol.status !== 'optimal' || !sol.values) return numerical(p.objective, stats, sol.rawStatus);
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
    ...emptyResult('infeasible', p.objective, stats),
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

function buildLp(p: Problem, mode: LpMode): LpModel {
  const variables: LpVariable[] = [];
  const objective: LpTerm[] = [];
  const balance = new Map<string, LpTerm[]>(p.items.map((i) => [i, []]));
  const nodeTerms = new Map<string, LpTerm[]>();
  const cap = mode === 'capped' ? SANITY_CAP : Infinity;

  for (const r of p.recipes) {
    const v = recipeVar(r.id);
    variables.push({ name: v, lo: 0, hi: cap });
    if (mode !== 'elastic') objective.push({ var: v, coef: (p.cost.get(r.id) ?? 0) + REGULARIZER });
    for (const f of r.outputs) balance.get(f.item)!.push({ var: v, coef: f.rate });
    for (const f of r.inputs) balance.get(f.item)!.push({ var: v, coef: -f.rate });
    if (r.node) nodeTerms.set(r.node, [...(nodeTerms.get(r.node) ?? []), { var: v, coef: 1 }]);
  }
  const constraints: LpConstraint[] = [];
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
  return { sense: 'min', objective, variables, constraints };
}

/** Objective cost per machine of each recipe: only node-drawing recipes cost anything under O1/O2. */
function objectiveCosts(
  model: Model,
  objective: ObjectiveId,
  weights: Readonly<Record<string, number>> | undefined,
  recipes: readonly Recipe[],
  nodes: Map<string, ResourceNode>,
): Map<string, number> {
  const mapTotal = new Map<string, number>();
  for (const n of model.nodes)
    mapTotal.set(n.resource, (mapTotal.get(n.resource) ?? 0) + n.count * n.nne);
  const cost = new Map<string, number>();
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
      p.objective,
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
    if (r.node) add(nodeUse, r.node, n);
    const power = r.powerMW * n;
    if (power >= 0) consumptionMW += power;
    else generationMW -= power;
    recipes.push({
      id: r.id,
      name: r.name,
      machine: r.machine,
      machines: n,
      machinesCeil: Math.ceil(n - 1e-6),
      powerMW: power,
    });
  }

  const items: ItemFlow[] = [];
  const failures: string[] = [];
  for (const item of p.items) {
    const flow: ItemFlow = {
      item,
      produced: produced.get(item) ?? 0,
      consumed: consumed.get(item) ?? 0,
      imported: imported.get(item) ?? 0,
      surplus: surplus.get(item) ?? 0,
      demand: p.demand.get(item) ?? 0,
    };
    const residual = flow.produced - flow.consumed + flow.imported - flow.surplus - flow.demand;
    const scale = Math.max(1, flow.produced, flow.consumed, flow.imported, flow.demand);
    if (Math.abs(residual) > BALANCE_TOL * scale)
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
  if (failures.length) return checkFailed(p.objective, stats, failures.join('; '));

  let objectiveValue = 0;
  for (const [id, n] of x) objectiveValue += (p.cost.get(id) ?? 0) * n;

  return {
    status: 'ok',
    objective: p.objective,
    objectiveValue,
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

function validate(model: Model, request: SolveRequest): Diagnostic | undefined {
  const bad = (message: string): Diagnostic => ({
    code: 'invalid-request',
    severity: 'error',
    message,
  });
  const known = new Set(model.items.map((i) => i.id));
  const objective = request.objective ?? 'resources';
  if (objective !== 'resources' && objective !== 'scarcity')
    return bad(`Unknown objective "${String(objective)}".`);
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
  objective: ObjectiveId,
  stats: SolveStats = { recipes: 0, columns: 0, rows: 0 },
): SolveResult {
  return {
    status,
    objective,
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
  objective: ObjectiveId,
  diagnostics: Diagnostic[],
): SolveResult {
  return { ...emptyResult(status, objective), diagnostics };
}

const numerical = (objective: ObjectiveId, stats: SolveStats, raw: string): SolveResult => ({
  ...emptyResult('error', objective, stats),
  diagnostics: [{ code: 'numerical', severity: 'error', message: `The LP solver failed: ${raw}.` }],
});

const checkFailed = (objective: ObjectiveId, stats: SolveStats, detail: string): SolveResult => ({
  ...emptyResult('error', objective, stats),
  diagnostics: [
    {
      code: 'check-failed',
      severity: 'error',
      message: `The solved plan failed its checks: ${detail}.`,
    },
  ],
});
