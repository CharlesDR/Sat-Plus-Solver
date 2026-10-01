import type { Model } from '@sps/data';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../../fixtures/vanilla-mini/model.json';
import { createHighsBackend } from '../lp/highs';
import type { LpBackend, LpSolution } from '../lp/types';
import { solve } from './solve';
import type { SolveRequest } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();

/** Wraps HiGHS and overrides the status of the first `n` solves. */
function forcing(status: LpSolution['status'], n = 1, withValues = false): LpBackend {
  let left = n;
  return {
    async solve(lp, options) {
      const real = await backend.solve(lp, options);
      if (left-- <= 0) return real;
      return {
        status,
        rawStatus: `forced ${status}`,
        ...(withValues && real.values ? { values: real.values, objective: real.objective } : {}),
      };
    },
  };
}

const plate60: SolveRequest = { targets: [{ item: 'iron-plate', rate: 60 }] };

describe('solve: plans', () => {
  test('Iron Plate 60/min: machines, ceilings, nodes, power, items', async () => {
    const r = await solve(model, plate60, backend);
    expect(r.status).toBe('ok');
    expect(r.diagnostics).toEqual([]);
    expect(r.recipes.map((x) => [x.id, x.machinesCeil])).toEqual([
      ['iron-ingot', 3],
      ['iron-plate', 3],
      ['mine-iron-ore', 2],
    ]);
    expect(r.nodes).toEqual([
      {
        node: 'node:iron-ore:normal',
        used: expect.closeTo(1.5, 9),
        budget: 40,
        nne: expect.closeTo(1.5, 9),
      },
    ]);
    // 3 × 4 MW smelters + 3 × 4 MW constructors + 1.5 × 5 MW miners.
    expect(r.power.consumptionMW).toBeCloseTo(31.5, 9);
    expect(r.power.generationMW).toBe(0);
    const plate = r.items.find((i) => i.item === 'iron-plate')!;
    expect(plate.produced).toBeCloseTo(60, 9);
    expect(plate.demand).toBe(60);
  });

  test('world demand adds to the targets', async () => {
    const r = await solve(
      model,
      { targets: [{ item: 'iron-plate', rate: 40 }], demand: [{ item: 'iron-plate', rate: 20 }] },
      backend,
    );
    expect(r.recipes.find((x) => x.id === 'iron-plate')!.machines).toBeCloseTo(3, 9);
  });

  test('imports are used before nodes, up to their cap', async () => {
    const r = await solve(
      model,
      { ...plate60, imports: [{ item: 'iron-ingot', cap: Infinity }] },
      backend,
    );
    expect(r.imports).toEqual([{ item: 'iron-ingot', rate: expect.closeTo(90, 9) }]);
    expect(r.nodes).toEqual([]);
    expect(r.objectiveValue).toBe(0);
  });

  test('an unused import is not reported, even if the LP routed it to surplus', async () => {
    const r = await solve(model, { ...plate60, imports: [{ item: 'cable', cap: 100 }] }, backend);
    expect(r.imports).toEqual([]);
    expect(r.surplus).toEqual([]);
  });

  test('excluded recipes are not used, and pruning drops unrelated ones', async () => {
    const r = await solve(
      model,
      { targets: [{ item: 'screw', rate: 40 }], recipes: { exclude: ['cast-screw'] } },
      backend,
    );
    expect(r.recipes.map((x) => x.id)).toEqual([
      'iron-ingot',
      'iron-rod',
      'mine-iron-ore',
      'screw',
    ]);
    // iron-ingot, iron-rod, screw, mine-iron-ore: nothing about copper, oil or steel.
    expect(r.stats.recipes).toBe(4);
  });

  test('an explicit node budget replaces the pool; missing nodes get 0', async () => {
    const r = await solve(
      model,
      { ...plate60, nodeBudget: { 'node:iron-ore:normal': 2 } },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(r.nodes[0]!.budget).toBe(2);
  });

  test('scarcity weights can be overridden', async () => {
    const cable = { targets: [{ item: 'cable', rate: 30 }], objective: 'scarcity' } as const;
    const byDefault = await solve(model, cable, backend);
    expect(byDefault.recipes.map((x) => x.id)).toContain('iron-wire');
    const cheapCopper = await solve(
      model,
      { ...cable, scarcityWeights: { 'copper-ore': 0.001 } },
      backend,
    );
    expect(cheapCopper.recipes.map((x) => x.id)).toContain('wire');
    expect(cheapCopper.objectiveValue).toBeCloseTo(0.5 * 0.001, 12);
  });

  test('is deterministic', async () => {
    const req: SolveRequest = {
      targets: [
        { item: 'modular-frame', rate: 3 },
        { item: 'cable', rate: 17 },
        { item: 'mw', rate: 100 },
      ],
    };
    const a = await solve(model, req, backend);
    const b = await solve(model, req, createHighsBackend());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('solve: diagnostics (§3.5)', () => {
  test('unreachable target names the disabled recipes that would fix it', async () => {
    const r = await solve(
      model,
      { targets: [{ item: 'plastic', rate: 20 }], recipes: { exclude: ['extract-crude-oil'] } },
      backend,
    );
    expect(r.status).toBe('unreachable');
    expect(r.diagnostics).toEqual([
      {
        code: 'unreachable',
        severity: 'error',
        item: 'plastic',
        message:
          'Nothing can produce Plastic. Enabling one of these recipes would fix it: extract-crude-oil.',
        fixes: ['extract-crude-oil'],
      },
    ]);
  });

  test('unreachable: direct producers rank before upstream ones', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'screw', rate: 40 }],
        recipes: { exclude: ['screw', 'iron-rod', 'cast-screw'] },
      },
      backend,
    );
    const d = r.diagnostics[0]!;
    expect(d.code === 'unreachable' && d.fixes).toEqual(['cast-screw', 'screw']);
  });

  test('unreachable with no fix suggests an import', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'heavy-oil-residue', rate: 1 }],
        nodeBudget: 'pool',
        recipes: { exclude: ['plastic', 'rubber'] },
      },
      backend,
    );
    expect(r.status).toBe('unreachable');
    expect(r.diagnostics[0]!.message).toContain('Enabling one of these recipes');
    const none = await solve(
      { ...model, recipes: model.recipes.filter((x) => x.id !== 'concrete') },
      { targets: [{ item: 'concrete', rate: 1 }] },
      backend,
    );
    expect(none.diagnostics[0]!.message).toBe(
      'Nothing can produce Concrete. No recipe in the dataset can make it from here; add an import.',
    );
  });

  test('infeasible node budget reports the missing nodes', async () => {
    const r = await solve(
      model,
      { ...plate60, nodeBudget: { 'node:iron-ore:normal': 1 } },
      backend,
    );
    expect(r.status).toBe('infeasible');
    expect(r.diagnostics).toEqual([
      {
        code: 'infeasible',
        severity: 'error',
        message: 'Infeasible: needs 0.5 more normal Iron Ore nodes.',
        relaxations: [
          { kind: 'node', node: 'node:iron-ore:normal', amount: expect.closeTo(0.5, 9) },
        ],
      },
    ]);
  });

  test('infeasible import cap reports the missing import', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'steel-beam', rate: 30 }],
        imports: [{ item: 'steel-ingot', cap: 80 }],
        recipes: { exclude: ['steel-ingot', 'solid-steel-ingot'] },
      },
      backend,
    );
    expect(r.status).toBe('infeasible');
    expect(r.diagnostics[0]!.message).toBe('Infeasible: needs 40/min more imported Steel Ingot.');
  });

  test('unbounded names the direction', async () => {
    const r = await solve(model, plate60, forcing('unbounded'));
    expect(r.status).toBe('unbounded');
    const d = r.diagnostics[0]!;
    expect(d.code).toBe('unbounded');
    expect(d.message).toContain('Add a cap');
  });

  test('infeasible-or-unbounded is told apart by the capped re-solve', async () => {
    const feasible = await solve(model, plate60, forcing('infeasible-or-unbounded'));
    expect(feasible.status).toBe('unbounded');
    const infeasible = await solve(
      model,
      { ...plate60, nodeBudget: { 'node:iron-ore:normal': 1 } },
      forcing('infeasible-or-unbounded'),
    );
    expect(infeasible.status).toBe('infeasible');
  });

  test('a backend error is a numerical diagnostic', async () => {
    const r = await solve(model, plate60, forcing('error'));
    expect(r.status).toBe('error');
    expect(r.diagnostics).toEqual([
      { code: 'numerical', severity: 'error', message: 'The LP solver failed: forced error.' },
    ]);
  });

  test('a time limit with a plan returns it with a warning; without one it is an error', async () => {
    const withPlan = await solve(model, plate60, forcing('time-limit', 1, true));
    expect(withPlan.status).toBe('ok');
    expect(withPlan.diagnostics.map((d) => d.code)).toEqual(['time-limit']);
    const without = await solve(model, plate60, forcing('iteration-limit'));
    expect(without.status).toBe('error');
    expect(without.diagnostics.map((d) => d.code)).toEqual(['time-limit']);
  });

  test('a plan that fails its checks is an error, not a warning', async () => {
    const lying: LpBackend = {
      async solve(lp, options) {
        const real = await backend.solve(lp, options);
        const values = new Map(real.values);
        values.set('recipe:iron-plate', 2.9);
        return { ...real, values };
      },
    };
    const r = await solve(model, plate60, lying);
    expect(r.status).toBe('error');
    expect(r.diagnostics[0]!.code).toBe('check-failed');
    expect(r.recipes).toEqual([]);
  });

  test('negative variables fail the check', async () => {
    const lying: LpBackend = {
      async solve(lp, options) {
        const real = await backend.solve(lp, options);
        return { ...real, values: new Map([...real.values!, ['surplus:iron-plate', -1e-6]]) };
      },
    };
    const r = await solve(model, plate60, lying);
    expect(r.diagnostics[0]!.message).toContain('negative variables: surplus:iron-plate');
  });

  test('invalid requests are rejected', async () => {
    const bad = async (req: SolveRequest) => (await solve(model, req, backend)).diagnostics[0]!;
    expect((await bad({ targets: [{ item: 'nope', rate: 1 }] })).message).toBe(
      'Unknown item "nope".',
    );
    expect((await bad({ targets: [{ item: 'cable', rate: -1 }] })).code).toBe('invalid-request');
    expect((await bad({ targets: [{ item: 'cable', rate: Infinity }] })).code).toBe(
      'invalid-request',
    );
    expect((await bad({ ...plate60, imports: [{ item: 'iron-ingot', cap: -1 }] })).code).toBe(
      'invalid-request',
    );
    expect(
      (await bad({ ...plate60, objective: 'scarcity', scarcityWeights: { 'iron-ore': -1 } })).code,
    ).toBe('invalid-request');
  });
});
