import type { Model, Recipe } from '@sps/data';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../../fixtures/vanilla-mini/model.json';
import { createHighsBackend } from '../lp/highs';
import type { LpBackend, LpSolution } from '../lp/types';
import { compareAlternates } from './alternates';
import {
  clampTolerance,
  DEFAULT_TOLERANCE,
  MAX_TOLERANCE,
  MILP_TIME_LIMIT_SECONDS,
  MIN_TOLERANCE,
  solve,
} from './solve';
import type { ObjectiveId, SolveRequest, SolveResult } from './types';

/** M4 (docs/PLAN.md): objectives O3–O6, the lexicographic stack, MILP, import costing, power. */
const model = vanillaMini as Model;
const backend = createHighsBackend();

const ids = (r: SolveResult) => r.recipes.map((x) => x.id);
const cable30: SolveRequest = { targets: [{ item: 'cable', rate: 30 }] };
/** Iron Wire (an alternate) is what makes copper-free Cable possible. */
const withAlternates = { recipes: { alternates: true } } as const;

describe('lexicographic stack', () => {
  test('a secondary objective changes the plan while the primary stays within tolerance', async () => {
    // O1 alone: copper Wire (0.5 NNE). O2 prefers iron (copper is the scarcer node),
    // and Iron Wire costs 0.5556 NNE, within 20% of the O1 optimum.
    const primary = await solve(model, cable30, backend);
    expect(ids(primary)).toContain('wire');
    const stacked = await solve(
      model,
      { ...cable30, ...withAlternates, objectives: ['resources', 'scarcity'], tolerance: 0.2 },
      backend,
    );
    expect(stacked.status).toBe('ok');
    expect(ids(stacked)).toContain('iron-wire');
    expect(ids(stacked)).not.toContain('wire');
    const [o1, o2] = stacked.stages;
    expect(o1!.optimum).toBeCloseTo(primary.objectiveValue!, 12);
    expect(o1!.value).toBeGreaterThan(o1!.optimum);
    expect(o1!.value).toBeLessThanOrEqual(o1!.optimum * 1.2 + 1e-12);
    expect(o2!.objective).toBe('scarcity');
    expect(stacked.objective).toBe('resources');
    expect(stacked.objectiveValue).toBe(o1!.value);
  });

  test('at the default tolerance the secondary only breaks ties', async () => {
    const r = await solve(model, { ...cable30, objectives: ['resources', 'scarcity'] }, backend);
    expect(ids(r)).toContain('wire');
    expect(r.stages[0]!.value).toBeLessThanOrEqual(0.5 * (1 + DEFAULT_TOLERANCE) + 1e-12);
  });

  test('`objective` is a one-objective stack; giving both is rejected', async () => {
    const a = await solve(model, { ...cable30, objective: 'machines' }, backend);
    const b = await solve(model, { ...cable30, objectives: ['machines'] }, backend);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.objectives).toEqual(['machines']);
    const both = await solve(
      model,
      { ...cable30, objective: 'machines', objectives: ['machines'] },
      backend,
    );
    expect(both.diagnostics[0]!.code).toBe('invalid-request');
  });

  test('out-of-range tolerance is rejected; the clamp helper is for UI inputs', async () => {
    for (const tolerance of [0, MIN_TOLERANCE / 2, 0.95, -1, NaN, Infinity]) {
      const r = await solve(model, { ...cable30, tolerance }, backend);
      expect([tolerance, r.status, r.diagnostics[0]!.code]).toEqual([
        tolerance,
        'error',
        'invalid-request',
      ]);
    }
    expect((await solve(model, { ...cable30, tolerance: 0.5 }, backend)).diagnostics[0]).toBe(
      undefined,
    );
    for (const ok of [MIN_TOLERANCE, MAX_TOLERANCE])
      expect((await solve(model, { ...cable30, tolerance: ok }, backend)).status).toBe('ok');
    expect(
      (await solve(model, { ...cable30, tolerance: 0.95 }, backend)).diagnostics[0]!.message,
    ).toBe('Tolerance must be between 0.01% and 90% (got 95%).');
    expect(clampTolerance(0)).toBe(MIN_TOLERANCE);
    expect(clampTolerance(2)).toBe(MAX_TOLERANCE);
    expect(clampTolerance(0.05)).toBe(0.05);
    expect(clampTolerance(NaN)).toBe(DEFAULT_TOLERANCE);
  });

  test('stack rules: known ids, no repeats, `output` first only, not empty', async () => {
    const code = async (req: SolveRequest) => (await solve(model, req, backend)).diagnostics[0];
    for (const objectives of [
      [],
      ['resources', 'resources'],
      ['resources', 'output'],
      ['nope'],
    ] as unknown as ObjectiveId[][])
      expect((await code({ ...cable30, objectives }))!.code).toBe('invalid-request');
    expect(
      (await code({ targets: [{ item: 'cable', rate: 0 }], objectives: ['output'] }))!.message,
    ).toBe('Maximizing output needs at least one target to set the output ratio.');
  });

  test('a later stage that fails is retried at 10× tolerance, with a warning', async () => {
    let calls = 0;
    const flaky: LpBackend = {
      async solve(lp, options) {
        calls++;
        if (calls === 2) return { status: 'infeasible', rawStatus: 'forced infeasible' };
        return backend.solve(lp, options);
      },
    };
    const r = await solve(model, { ...cable30, objectives: ['resources', 'machines'] }, flaky);
    expect(r.status).toBe('ok');
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ code: 'tolerance-relaxed', tolerance: DEFAULT_TOLERANCE * 10 }),
    ]);
    expect(calls).toBe(3);

    const broken: LpBackend = {
      async solve(lp, options) {
        return lp.constraints.some((c) => c.name.startsWith('lex:'))
          ? { status: 'error', rawStatus: 'forced error' }
          : backend.solve(lp, options);
      },
    };
    const e = await solve(model, { ...cable30, objectives: ['resources', 'machines'] }, broken);
    expect(e.status).toBe('error');
    expect(e.diagnostics[0]!.code).toBe('numerical');
  });

  test('is deterministic', async () => {
    const req: SolveRequest = {
      targets: [
        { item: 'modular-frame', rate: 3 },
        { item: 'cable', rate: 17 },
        { item: 'mw', rate: 100 },
      ],
      objectives: ['resourceTypes', 'power', 'machines', 'resources'],
      tolerance: 0.05,
    };
    const a = await solve(model, req, backend);
    const b = await solve(model, req, createHighsBackend());
    expect(a.status).toBe('ok');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('objectives', () => {
  test('O3 machines: fewest machines', async () => {
    const r = await solve(model, { ...cable30, objective: 'machines' }, backend);
    // Copper: 0.5 miner + 1 smelter + 2 wire + 1 cable.
    expect(r.objectiveValue).toBeCloseTo(4.5, 9);
    expect(r.recipes.reduce((s, x) => s + x.machines, 0)).toBeCloseTo(4.5, 9);
  });

  test('O4 power: machine draw only, so it never starts generators', async () => {
    const r = await solve(
      model,
      { targets: [{ item: 'iron-plate', rate: 60 }], objective: 'power' },
      backend,
    );
    expect(r.power.generationMW).toBe(0);
    expect(ids(r)).not.toContain('coal-generator');
    expect(r.objectiveValue).toBeCloseTo(r.power.consumptionMW, 9);
    expect(r.objectiveValue).toBeCloseTo(31.5, 9);
  });

  test('O4 with an MW target: counts the fuel chain draw, not the generation', async () => {
    const r = await solve(
      model,
      { targets: [{ item: 'mw', rate: 75 }], objective: 'power' },
      backend,
    );
    expect(r.objectiveValue).toBeCloseTo(8.75, 9);
    expect(r.power.generationMW).toBeCloseTo(75, 9);
  });

  test('O5 max output reaches its cap', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'iron-plate', rate: 20 }],
        objective: 'output',
        imports: [{ item: 'iron-ingot', cap: 90 }],
        nodeBudget: {},
      },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(r.outputScale).toBeCloseTo(3, 9);
    expect(r.objectiveValue).toBeCloseTo(3, 9);
    expect(r.imports).toEqual([{ item: 'iron-ingot', rate: expect.closeTo(90, 9) }]);
    expect(r.items.find((i) => i.item === 'iron-plate')!.demand).toBeCloseTo(60, 9);
  });

  test('O5 keeps the target ratio and adds world demand on top', async () => {
    const r = await solve(
      model,
      {
        targets: [
          { item: 'iron-plate', rate: 2 },
          { item: 'iron-rod', rate: 1 },
        ],
        demand: [{ item: 'iron-plate', rate: 10 }],
        objectives: ['output', 'machines'],
        nodeBudget: { 'node:iron-ore:normal': 2 },
      },
      backend,
    );
    // 2 nodes = 120 ore = 120 ingots: 10 plates of world demand take 15, the
    // remaining 105 make 2t plates (3t ingots) and t rods (t ingots): t* = 26.25.
    // The secondary (machines) may give up the default 0.01% of it.
    const [output] = r.stages;
    expect(output!.optimum).toBeCloseTo(26.25, 9);
    const t = r.outputScale!;
    expect(t).toBe(output!.value);
    expect(t).toBeGreaterThanOrEqual(26.25 * (1 - DEFAULT_TOLERANCE) - 1e-9);
    expect(t).toBeLessThanOrEqual(26.25 + 1e-9);
    const demand = (item: string) => r.items.find((i) => i.item === item)!.demand;
    expect(demand('iron-plate')).toBeCloseTo(10 + 2 * t, 9);
    expect(demand('iron-rod')).toBeCloseTo(t, 9);
    expect(r.stages.map((s) => s.objective)).toEqual(['output', 'machines']);
  });

  test('O5 with an unlimited source is unbounded and names the source', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'iron-plate', rate: 20 }],
        objective: 'output',
        imports: [{ item: 'iron-ingot', cap: Infinity }],
      },
      backend,
    );
    expect(r.status).toBe('unbounded');
    const d = r.diagnostics[0]!;
    expect(d.code === 'unbounded' && d.directions).toEqual(['import:iron-ingot']);
  });

  test('O6 uses fewer resource types than O1', async () => {
    const req: SolveRequest = {
      targets: [
        { item: 'cable', rate: 30 },
        { item: 'iron-plate', rate: 20 },
      ],
      ...withAlternates,
    };
    const types = (r: SolveResult) => new Set(r.nodes.map((n) => n.node)).size;
    const o1 = await solve(model, req, backend);
    const o6 = await solve(model, { ...req, objectives: ['resourceTypes', 'resources'] }, backend);
    expect(types(o1)).toBe(2);
    expect(types(o6)).toBe(1);
    expect(o6.objectiveValue).toBe(1);
    expect(ids(o6)).toContain('iron-wire');
    // Secondary O1 picks the cheapest single-type plan: 1/2 + 5/9 NNE.
    expect(o6.stages[1]!.value).toBeCloseTo(0.5 + 5 / 9, 9);
  });

  test('O6 counts a resource type an import brings in', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'iron-plate', rate: 20 }],
        imports: [{ item: 'iron-ingot', cap: Infinity }],
        objectives: ['resourceTypes'],
        costImports: true,
      },
      backend,
    );
    expect(r.objectiveValue).toBe(1);
    expect(r.importCosts![0]!.resourceTypes).toEqual(['iron-ore']);
  });
});

describe('O4 and conversion generators (turbines)', () => {
  // vanilla-mini plus a slime turbine: Energized Slime → Spent Slime + 100 MW.
  // Spent Slime has no other source, and a heater can re-energize it from coal.
  const flow = (item: string, rate: number) => ({ item, rate });
  const extra = (
    id: string,
    kind: Recipe['kind'],
    powerMW: number,
    inputs: Recipe['inputs'],
    outputs: Recipe['outputs'],
  ): Recipe => ({
    id,
    name: id,
    machine: id,
    kind,
    alternate: false,
    tier: '0-0',
    inputs,
    outputs,
    powerMW,
    clock: 1,
    source: 'dataset',
  });
  const slime: Model = {
    ...model,
    items: [
      ...model.items,
      ...['energized-slime', 'spent-slime'].map((id) => ({
        id,
        name: id,
        form: 'fluid' as const,
        sinkPoints: 0,
        tier: '0-0',
      })),
    ],
    recipes: [
      ...model.recipes,
      extra(
        'energize-from-coal',
        'production',
        10,
        [flow('coal', 30)],
        [flow('energized-slime', 10)],
      ),
      extra(
        'slime-turbine',
        'generator',
        -100,
        [flow('energized-slime', 10)],
        [flow('spent-slime', 10), flow('mw', 100)],
      ),
      extra(
        'slime-heater',
        'production',
        0,
        [flow('spent-slime', 10), flow('coal', 15)],
        [flow('energized-slime', 10)],
      ),
    ],
  };
  const spent: SolveRequest = { targets: [flow('spent-slime', 10)] };
  const turbines = (r: SolveResult) =>
    r.recipes.find((x) => x.id === 'slime-turbine')?.machines ?? 0;

  test('O4 first gets no credit, even for a turbine the plan needs', async () => {
    const r = await solve(slime, { ...spent, objective: 'power' }, backend);
    expect(turbines(r)).toBeCloseTo(1, 9);
    expect(r.power.generationMW).toBeCloseTo(100, 9);
    expect(r.objectiveValue).toBeCloseTo(r.power.consumptionMW, 9);
  });

  test('O4 after another objective credits the turbines that objective runs', async () => {
    const r = await solve(slime, { ...spent, objectives: ['resources', 'power'] }, backend);
    expect(turbines(r)).toBeCloseTo(1, 9);
    const o4 = r.stages[1]!;
    expect(o4.value).toBeCloseTo(r.power.consumptionMW - 100, 9);
    expect(o4.value).toBeLessThan(0);
  });

  test('the credit never starts more turbines than the earlier stages run', async () => {
    // At 90% tolerance O4 could burn more coal through the heater loop for
    // more turbine credit; the cap keeps the turbines at the O1 count.
    const r = await solve(
      slime,
      { ...spent, objectives: ['resources', 'power'], tolerance: MAX_TOLERANCE },
      backend,
    );
    expect(turbines(r)).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.recipes.map((x) => x.id)).not.toContain('slime-heater');
    expect(r.power.generationMW).toBeLessThanOrEqual(100 + 1e-6);
  });
});

describe('whole machines (MILP)', () => {
  test('machine counts and node usage are whole, and O3 counts whole machines', async () => {
    const req: SolveRequest = {
      targets: [{ item: 'modular-frame', rate: 3 }],
      objective: 'machines',
    };
    const lp = await solve(model, req, backend);
    const milp = await solve(model, { ...req, wholeMachines: true }, backend);
    expect(milp.status).toBe('ok');
    for (const x of milp.recipes) {
      expect(Number.isInteger(x.machinesCeil)).toBe(true);
      expect(x.machinesCeil).toBeGreaterThanOrEqual(x.machines - 1e-9);
    }
    for (const n of milp.nodes) expect(Number.isInteger(n.used)).toBe(true);
    const whole = milp.recipes.reduce((s, x) => s + x.machinesCeil, 0);
    expect(milp.objectiveValue).toBeCloseTo(whole, 9);
    expect(milp.objectiveValue!).toBeGreaterThanOrEqual(lp.objectiveValue!);
    expect(milp.stages[0]!.gap).toBeUndefined();
  });

  test('a MILP gets a 5 s limit by default; a timeout returns the best plan and its gap', async () => {
    const seen: (number | undefined)[] = [];
    const timing: LpBackend = {
      async solve(lp, options) {
        seen.push(options?.timeLimitSeconds);
        const real = await backend.solve(lp, options);
        if (!lp.variables.some((v) => v.integer)) return real;
        return { ...real, status: 'time-limit', rawStatus: 'Time limit reached', gap: 0.125 };
      },
    };
    const r = await solve(
      model,
      { targets: [{ item: 'modular-frame', rate: 3 }], objective: 'machines', wholeMachines: true },
      timing,
    );
    // The LP relaxation (for the warm start), the MILP, then the two LPs
    // with its machine counts fixed (the polish).
    expect(seen).toEqual([
      MILP_TIME_LIMIT_SECONDS,
      MILP_TIME_LIMIT_SECONDS,
      MILP_TIME_LIMIT_SECONDS,
      MILP_TIME_LIMIT_SECONDS,
    ]);
    expect(r.status).toBe('ok');
    expect(r.recipes.length).toBeGreaterThan(0);
    expect(r.stages[0]!.gap).toBe(0.125);
    expect(r.diagnostics).toEqual([
      {
        code: 'time-limit',
        severity: 'warning',
        gap: 0.125,
        message:
          'The solver stopped (Time limit reached) in stage 1 (machines); this is the best plan found and may not be optimal (gap 12.5%).',
      },
    ]);
  });

  test('a MILP timeout with no plan is an error', async () => {
    const none: LpBackend = {
      async solve(): Promise<LpSolution> {
        return { status: 'time-limit', rawStatus: 'Time limit reached' };
      },
    };
    const r = await solve(model, { ...cable30, objective: 'resourceTypes' }, none);
    expect(r.status).toBe('error');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['time-limit']);
  });

  test('an explicit time limit applies to every stage', async () => {
    const seen: (number | undefined)[] = [];
    const spy: LpBackend = {
      async solve(lp, options) {
        seen.push(options?.timeLimitSeconds);
        return backend.solve(lp, options);
      },
    };
    await solve(model, { ...cable30, objectives: ['resources', 'resourceTypes'] }, spy, {
      timeLimitSeconds: 2,
    });
    // Stage 1 LP; stage 2 relaxation, MILP and the two fixed-count LPs.
    expect(seen).toEqual([2, 2, 2, 2, 2]);
  });
});

describe('import costing (standalone mode)', () => {
  test('embodied cost equals the standalone optimum', async () => {
    const standalone = await solve(model, { targets: [{ item: 'iron-ingot', rate: 1 }] }, backend);
    const r = await solve(
      model,
      {
        targets: [{ item: 'iron-plate', rate: 60 }],
        imports: [{ item: 'iron-ingot', cap: Infinity }],
        costImports: true,
      },
      backend,
    );
    expect(r.importCosts).toEqual([
      {
        item: 'iron-ingot',
        cost: { resources: standalone.objectiveValue },
        resourceTypes: ['iron-ore'],
      },
    ]);
    // 90 ingots/min at 1/60 NNE each: the same as making them here.
    expect(r.objectiveValue).toBeCloseTo(1.5, 9);
  });

  test('costed imports compete with local production; free ones always win', async () => {
    // Steel Ingot via the alternate costs less in NNE than the standard recipe;
    // a costed import is used only when it is cheaper than local production.
    const req: SolveRequest = {
      targets: [{ item: 'steel-beam', rate: 15 }],
      imports: [{ item: 'steel-ingot', cap: Infinity }],
      recipes: { exclude: ['solid-steel-ingot'] },
    };
    const free = await solve(model, req, backend);
    expect(free.imports).toEqual([{ item: 'steel-ingot', rate: expect.closeTo(60, 9) }]);
    const costed = await solve(model, { ...req, costImports: true }, backend);
    const standalone = await solve(
      model,
      { targets: [{ item: 'steel-ingot', rate: 1 }], recipes: req.recipes! },
      backend,
    );
    expect(costed.objectiveValue).toBeCloseTo(60 * standalone.objectiveValue!, 9);
  });

  test('costs follow the stack, per objective', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'iron-plate', rate: 20 }],
        imports: [{ item: 'iron-ingot', cap: 30 }],
        objectives: ['machines', 'power'],
        costImports: true,
      },
      backend,
    );
    // 1 ingot/min: 1/60 miner + 1/30 smelter; 5/60 + 4/30 MW.
    expect(r.importCosts![0]!.cost.machines).toBeCloseTo(1 / 60 + 1 / 30, 12);
    expect(r.importCosts![0]!.cost.power).toBeCloseTo(5 / 60 + 4 / 30, 12);
  });

  test('an import that cannot be made anywhere is free, with a warning', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'iron-plate', rate: 20 }],
        imports: [{ item: 'iron-ingot', cap: Infinity }],
        recipes: { exclude: ['iron-ingot'] },
        costImports: true,
      },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(r.importCosts).toEqual([]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['import-cost']);
    expect(r.objectiveValue).toBe(0);
  });
});

describe('power', () => {
  test('2000 MW from Coal: a valid fuel chain', async () => {
    const r = await solve(model, { targets: [{ item: 'mw', rate: 2000 }] }, backend);
    expect(r.status).toBe('ok');
    const n = (id: string) => r.recipes.find((x) => x.id === id)?.machines ?? 0;
    expect(n('coal-generator')).toBeCloseTo(2000 / 75, 9);
    // Each generator burns 15 coal and 45 water per minute.
    expect(n('mine-coal') * 60).toBeCloseTo((2000 / 75) * 15, 9);
    expect(n('extract-water') * 120).toBeCloseTo((2000 / 75) * 45, 9);
    expect(r.power.generationMW).toBeCloseTo(2000, 9);
    expect(r.power.consumptionMW).toBeCloseTo((2000 / 75 / 4) * 5 + 10 * 20, 9);
    expect(r.power.netMW).toBeCloseTo(r.power.consumptionMW - 2000, 9);
    expect(r.items.find((i) => i.item === 'mw')).toMatchObject({
      produced: expect.closeTo(2000, 9),
    });
  });
});

describe('alternates report', () => {
  test('lists the alternates that improve the plan', async () => {
    const r = await compareAlternates(
      model,
      { targets: [{ item: 'screw', rate: 40 }], objectives: ['resources', 'power'] },
      backend,
    );
    expect(ids(r.without)).not.toContain('cast-screw');
    expect(r.used).toEqual(['cast-screw']);
    expect(r.stages.map((s) => s.objective)).toEqual(['resources', 'power']);
    expect(r.stages[1]!.with).toBeLessThan(r.stages[1]!.without);
  });
});
