import type { Model, Recipe, ResourceNode } from '@sps/data';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../../fixtures/vanilla-mini/model.json';
import { createHighsBackend } from '../lp/highs';
import { LEX_EPSILON, MIN_RATE, solve } from './solve';
import type { ObjectiveId, SolveRequest, SolveResult } from './types';

/**
 * Solver properties (docs/ARCHITECTURE.md §9), checked independently of the
 * solver's own checks. Fixed seeds keep CI deterministic.
 */
const backend = createHighsBackend();
const RUNS = 500;
const SEED = 20261001;
const TOL = 1e-6;

/** Recomputes balance, signs, budgets, caps and filters from the plan alone. */
function checkPlan(model: Model, req: SolveRequest, r: SolveResult): void {
  const recipes = new Map(model.recipes.map((x) => [x.id, x]));
  const excluded = new Set(req.recipes?.exclude ?? []);
  const net = new Map<string, number>();
  const scale = new Map<string, number>();
  const add = (item: string, v: number) => {
    net.set(item, (net.get(item) ?? 0) + v);
    scale.set(item, Math.max(scale.get(item) ?? 1, Math.abs(v)));
  };
  const nodeUse = new Map<string, number>();
  for (const u of r.recipes) {
    const rec = recipes.get(u.id)!;
    expect(u.machines).toBeGreaterThan(0);
    expect(excluded.has(u.id)).toBe(false);
    if (req.recipes?.alternates === false) expect(rec.alternate).toBe(false);
    // Heaters (A17): whole machines burn full fuel; the boiler runs at boilerLoad.
    let boiler = u.machines;
    if (rec.heater) {
      expect(Number.isInteger(u.machines)).toBe(true);
      expect(u.boilerLoad).toBeGreaterThanOrEqual(0);
      expect(u.boilerLoad).toBeLessThanOrEqual(1);
      boiler = u.machines * u.boilerLoad!;
    } else expect(u.boilerLoad).toBeUndefined();
    const at = (heaterSide?: true) => (heaterSide ? u.machines : boiler);
    for (const f of rec.outputs) add(f.item, f.rate * at(f.heater));
    for (const f of rec.inputs) add(f.item, -f.rate * at(f.heater));
    if (rec.node) nodeUse.set(rec.node, (nodeUse.get(rec.node) ?? 0) + u.machines);
  }
  for (const i of r.imports) {
    expect(i.rate).toBeGreaterThan(0);
    const cap = (req.imports ?? []).filter((x) => x.item === i.item).reduce((s, x) => s + x.cap, 0);
    expect(i.rate).toBeLessThanOrEqual(cap + TOL * Math.max(1, cap));
    add(i.item, i.rate);
  }
  for (const s of r.surplus) {
    expect(s.rate).toBeGreaterThan(0);
    add(s.item, -s.rate);
  }
  for (const t of [...req.targets, ...(req.demand ?? [])]) add(t.item, -t.rate);
  for (const [item, v] of net) expect(Math.abs(v)).toBeLessThanOrEqual(TOL * scale.get(item)!);
  const pool = new Map(model.nodes.map((n) => [n.id, n.count]));
  for (const [node, used] of nodeUse) {
    const budget =
      req.nodeBudget === undefined || req.nodeBudget === 'pool'
        ? pool.get(node)!
        : (req.nodeBudget[node] ?? 0);
    expect(used).toBeLessThanOrEqual(budget + TOL * Math.max(1, budget));
  }
}

/** Checks a result of any status, and returns it. */
async function solveAndCheck(model: Model, req: SolveRequest): Promise<SolveResult> {
  const r = await solve(model, req, backend);
  const tiny = [...req.targets, ...(req.demand ?? [])].some((t) => t.rate > 0 && t.rate < MIN_RATE);
  if (tiny) {
    expect(r.status).toBe('error');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['invalid-request']);
    return r;
  }
  expect(['ok', 'unreachable', 'infeasible']).toContain(r.status);
  if (r.status === 'ok') checkPlan(model, req, r);
  else expect(r.diagnostics.length).toBeGreaterThan(0);
  if (r.status === 'infeasible') {
    // Applying the reported relaxation makes the request feasible.
    const d = r.diagnostics[0]!;
    if (d.code !== 'infeasible') throw new Error(d.code);
    const pool = Object.fromEntries(model.nodes.map((n) => [n.id, n.count]));
    const budget: Record<string, number> = {
      ...(req.nodeBudget === undefined || req.nodeBudget === 'pool' ? pool : req.nodeBudget),
    };
    const imports = [...(req.imports ?? [])];
    for (const x of d.relaxations) {
      if (x.kind === 'node') budget[x.node] = (budget[x.node] ?? 0) + x.amount * (1 + 1e-6);
      else imports.push({ item: x.item, cap: x.amount * (1 + 1e-6) });
    }
    const fixed = await solve(model, { ...req, nodeBudget: budget, imports }, backend);
    expect(fixed.status).toBe('ok');
  }
  return r;
}

/** Mostly round numbers, sometimes arbitrary doubles, occasionally a sub-precision rate. */
const amount = (max: number) =>
  fc.oneof(
    { weight: 6, arbitrary: fc.integer({ min: 0, max: max * 4 }).map((n) => n / 4) },
    { weight: 3, arbitrary: fc.double({ min: MIN_RATE, max, noNaN: true }) },
    { weight: 1, arbitrary: fc.double({ min: 0, max: MIN_RATE, noNaN: true }) },
  );

const mini = vanillaMini as Model;
const miniItems = mini.items.map((i) => i.id);
const miniRecipes = mini.recipes.map((r) => r.id);

const miniRequest: fc.Arbitrary<SolveRequest> = fc.record(
  {
    targets: fc.array(fc.record({ item: fc.constantFrom(...miniItems), rate: amount(500) }), {
      minLength: 1,
      maxLength: 4,
    }),
    imports: fc.array(
      fc.record({
        item: fc.constantFrom(...miniItems),
        cap: fc.oneof(fc.constant(Infinity), amount(200)),
      }),
      { maxLength: 3 },
    ),
    objective: fc.constantFrom('resources' as const, 'scarcity' as const),
    recipes: fc.record({
      alternates: fc.boolean(),
      exclude: fc.uniqueArray(fc.constantFrom(...miniRecipes), { maxLength: 4 }),
    }),
    nodeBudget: fc.oneof(
      fc.constant('pool' as const),
      fc.dictionary(fc.constantFrom(...mini.nodes.map((n) => n.id)), amount(20)),
    ),
  },
  { requiredKeys: ['targets'] },
);

/** Random models: layered items, random recipes (cycles allowed), some node-drawing extraction. */
const randomModel: fc.Arbitrary<Model> = fc
  .record({
    items: fc.integer({ min: 2, max: 10 }),
    raws: fc.integer({ min: 1, max: 3 }),
    recipes: fc.array(
      fc.record({
        inputs: fc.array(fc.tuple(fc.nat(9), fc.integer({ min: 1, max: 60 })), { maxLength: 3 }),
        outputs: fc.array(fc.tuple(fc.nat(9), fc.integer({ min: 1, max: 60 })), {
          minLength: 1,
          maxLength: 2,
        }),
        alternate: fc.boolean(),
      }),
      { minLength: 1, maxLength: 12 },
    ),
    counts: fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 3, maxLength: 3 }),
  })
  .map(({ items, raws, recipes, counts }) => {
    const id = (k: number) => `i${k % items}`;
    const nodes: ResourceNode[] = [];
    const rs: Recipe[] = [];
    for (let k = 0; k < Math.min(raws, items); k++) {
      nodes.push({
        id: `node:${id(k)}`,
        resource: id(k),
        purity: 'normal',
        count: counts[k]!,
        nne: 1,
      });
      rs.push(recipe(`mine-${k}`, [], [[id(k), 60]], false, `node:${id(k)}`));
    }
    recipes.forEach((r, k) => {
      const outs = uniq(r.outputs.map(([i, v]) => [id(i), v] as [string, number]));
      const outIds = new Set(outs.map(([i]) => i));
      const ins = uniq(r.inputs.map(([i, v]) => [id(i), v] as [string, number])).filter(
        ([i]) => !outIds.has(i),
      );
      rs.push(recipe(`r${k}`, ins, outs, r.alternate));
    });
    return {
      meta: { schemaVersion: 1, dataHash: 'random', minerMk: 1 },
      items: Array.from({ length: items }, (_, k) => ({
        id: id(k),
        name: id(k),
        form: 'solid' as const,
        sinkPoints: 0,
        tier: '0-0',
      })),
      machines: [],
      recipes: rs,
      nodes,
      beltCapacities: [],
    };
  });

function uniq(flows: [string, number][]): [string, number][] {
  const seen = new Map<string, number>();
  for (const [i, v] of flows) if (!seen.has(i)) seen.set(i, v);
  return [...seen];
}

function recipe(
  id: string,
  inputs: [string, number][],
  outputs: [string, number][],
  alternate: boolean,
  node?: string,
): Recipe {
  return {
    id,
    name: id,
    machine: 'm',
    kind: node ? 'extraction' : 'production',
    alternate,
    tier: '0-0',
    inputs: inputs.map(([item, rate]) => ({ item, rate })),
    outputs: outputs.map(([item, rate]) => ({ item, rate })),
    powerMW: 1,
    clock: 1,
    source: 'dataset',
    ...(node ? { node } : {}),
  };
}

/**
 * Random models where most multi-input recipes are heaters (A17): the first
 * input and output form the boiler pair, every other flow is heater side.
 */
const randomHeaterModel: fc.Arbitrary<Model> = randomModel.chain((model) =>
  fc
    .array(
      fc.integer({ min: 0, max: 3 }).map((n) => n > 0),
      { minLength: model.recipes.length, maxLength: model.recipes.length },
    )
    .map((flags) => ({
      ...model,
      recipes: model.recipes.map((r, k): Recipe => {
        if (!flags[k] || r.node || r.inputs.length < 2) return r;
        const mark = (f: Recipe['inputs'][number], i: number) =>
          i === 0 ? f : { ...f, heater: true as const };
        return { ...r, heater: true, inputs: r.inputs.map(mark), outputs: r.outputs.map(mark) };
      }),
    })),
);

/** A random request against `model`'s items. */
const requestFor = (model: Model) =>
  fc.record({
    targets: fc.array(
      fc.record({
        item: fc.constantFrom(...model.items.map((i) => i.id)),
        rate: amount(300),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    imports: fc.array(
      fc.record({
        item: fc.constantFrom(...model.items.map((i) => i.id)),
        cap: amount(100),
      }),
      { maxLength: 2 },
    ),
    objective: fc.constantFrom('resources' as const, 'scarcity' as const),
    recipes: fc.record({ alternates: fc.boolean() }),
  });

const caseOf = (models: fc.Arbitrary<Model>) =>
  models.chain((model) => fc.record({ model: fc.constant(model), request: requestFor(model) }));

const randomCase = caseOf(randomModel);

describe('solver properties', () => {
  test(`vanilla-mini: ${RUNS} random requests give checked plans or valid diagnostics`, async () => {
    await fc.assert(
      fc.asyncProperty(miniRequest, async (req) => {
        await solveAndCheck(mini, req);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  test(`random models: ${RUNS} random cases give checked plans or valid diagnostics`, async () => {
    await fc.assert(
      fc.asyncProperty(randomCase, async ({ model, request }) => {
        await solveAndCheck(model, request);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  test(`random heater models: ${RUNS} random cases give checked plans or valid diagnostics (A17)`, async () => {
    await fc.assert(
      fc.asyncProperty(caseOf(randomHeaterModel), async ({ model, request }) => {
        await solveAndCheck(model, request);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  }, 60_000);

  test('scaling linearity: k × targets gives k × objective when nothing binds', async () => {
    const unbounded = Object.fromEntries(mini.nodes.map((n) => [n.id, Infinity]));
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            item: fc.constantFrom(...miniItems),
            rate: fc.double({ min: 0.1, max: 200, noNaN: true }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        fc.double({ min: 0.1, max: 50, noNaN: true }),
        fc.constantFrom('resources' as const, 'scarcity' as const),
        async (targets, k, objective) => {
          const base = await solve(mini, { targets, objective, nodeBudget: unbounded }, backend);
          const scaled = await solve(
            mini,
            {
              targets: targets.map((t) => ({ ...t, rate: t.rate * k })),
              objective,
              nodeBudget: unbounded,
            },
            backend,
          );
          expect(scaled.status).toBe(base.status);
          if (base.status !== 'ok') return;
          const a = base.objectiveValue! * k;
          const b = scaled.objectiveValue!;
          expect(Math.abs(a - b)).toBeLessThanOrEqual(TOL * Math.max(1, Math.abs(a)));
        },
      ),
      { numRuns: 100, seed: SEED },
    );
  });
});

/** M4: random objective stacks on vanilla-mini. */
const stackRequest = fc.record({
  targets: fc.array(
    fc.record({
      item: fc.constantFrom(...miniItems),
      rate: fc.integer({ min: 1, max: 800 }).map((n) => n / 4),
    }),
    { minLength: 1, maxLength: 3 },
  ),
  objectives: fc
    .shuffledSubarray<ObjectiveId>(
      ['resources', 'scarcity', 'machines', 'power', 'resourceTypes'],
      {
        minLength: 1,
        maxLength: 3,
      },
    )
    .chain((rest) => fc.boolean().map((max): ObjectiveId[] => (max ? ['output', ...rest] : rest))),
  tolerance: fc.constantFrom(1e-4, 0.01, 0.2),
  wholeMachines: fc.boolean(),
  imports: fc.array(
    fc.record({ item: fc.constantFrom(...miniItems), cap: fc.integer({ min: 1, max: 200 }) }),
    { maxLength: 2 },
  ),
  costImports: fc.boolean(),
});

describe('solver properties: objective stacks', () => {
  test('200 random stacks: checked plans, every stage within tolerance of its optimum', async () => {
    await fc.assert(
      fc.asyncProperty(stackRequest, async (req) => {
        const r = await solve(mini, req, backend);
        expect(['ok', 'unreachable', 'infeasible', 'unbounded']).toContain(r.status);
        if (r.status !== 'ok') return;
        expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        const relaxed = r.diagnostics.find((d) => d.code === 'tolerance-relaxed');
        const tol = relaxed?.code === 'tolerance-relaxed' ? relaxed.tolerance : req.tolerance;
        const scale = r.outputScale ?? 1;
        checkPlan(
          mini,
          { ...req, targets: req.targets.map((t) => ({ ...t, rate: t.rate * scale })) },
          r,
        );
        expect(r.stages.map((s) => s.objective)).toEqual(req.objectives);
        for (const s of r.stages) {
          const slack =
            tol * Math.max(Math.abs(s.optimum), LEX_EPSILON) +
            TOL * Math.max(1, Math.abs(s.optimum));
          if (s.objective === 'output') expect(s.value).toBeGreaterThanOrEqual(s.optimum - slack);
          else expect(s.value).toBeLessThanOrEqual(s.optimum + slack);
        }
        if (req.wholeMachines)
          for (const x of r.recipes) expect(Number.isInteger(x.machinesCeil)).toBe(true);
        // The primary is no worse than solving it alone, within tolerance.
        const alone = await solve(mini, { ...req, objectives: [req.objectives[0]!] }, backend);
        expect(alone.status).toBe('ok');
        const p = r.stages[0]!;
        expect(Math.abs(p.optimum - alone.stages[0]!.optimum)).toBeLessThanOrEqual(
          TOL * Math.max(1, Math.abs(p.optimum)),
        );
      }),
      { numRuns: 200, seed: SEED },
    );
  }, 60_000);
});
