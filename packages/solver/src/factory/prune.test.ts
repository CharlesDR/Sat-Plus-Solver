import type { Model, Recipe } from '@sps/data';
import { describe, expect, test } from 'vitest';
import { createHighsBackend } from '../lp/highs';
import { MIN_BRANCH, MIN_FLOW, solve } from './solve';
import type { SolveRequest, SolveResult } from './types';

/**
 * The prune pass (A34). Two routes make plates from ore: `slow` is lean on ore
 * (1 per plate) but takes a machine per plate/min; `fast` burns 2 ore per
 * plate at 100 plates/min. Resources first, machines second: stage 2 spends
 * stage 1's 0.01% room on a sliver of `fast` (about 1e-5 machines).
 */
const backend = createHighsBackend();

const base = (id: string, extra: Partial<Recipe>): Recipe => ({
  id,
  name: id,
  machine: id,
  kind: 'production',
  alternate: false,
  tier: '0-0',
  inputs: [],
  outputs: [],
  powerMW: 0,
  clock: 1,
  source: 'dataset',
  ...extra,
});

const model: Model = {
  meta: { schemaVersion: 2, dataHash: 'prune', minerMk: 1 },
  items: ['ore', 'plate'].map((id) => ({
    id,
    name: id,
    form: 'solid' as const,
    sinkPoints: 0,
    tier: '0-0',
  })),
  machines: [],
  recipes: [
    base('mine-ore', {
      kind: 'extraction',
      outputs: [{ item: 'ore', rate: 60 }],
      powerMW: 5,
      node: 'node:ore:normal',
    }),
    base('slow', {
      inputs: [{ item: 'ore', rate: 1 }],
      outputs: [{ item: 'plate', rate: 1 }],
    }),
    base('fast', {
      inputs: [{ item: 'ore', rate: 200 }],
      outputs: [{ item: 'plate', rate: 100 }],
    }),
  ],
  nodes: [{ id: 'node:ore:normal', resource: 'ore', purity: 'normal', count: 100, nne: 1 }],
  beltCapacities: [],
};

const plates: SolveRequest = {
  targets: [{ item: 'plate', rate: 10 }],
  objectives: ['resources', 'machines'],
};

const machines = (r: SolveResult, id: string) => r.recipes.find((x) => x.id === id)?.machines;

describe('prune pass (A34)', () => {
  test('without it, the second stage leaves a sliver of the other route', async () => {
    const r = await solve(model, { ...plates, minBranch: 0, minFlow: 0 }, backend);
    expect(r.status).toBe('ok');
    expect(machines(r, 'fast')).toBeGreaterThan(0);
    expect(machines(r, 'fast')).toBeLessThan(MIN_BRANCH);
    expect(r.stats.pruned).toBeUndefined();
  });

  test('by default, the sliver is dropped and every stage stays within tolerance', async () => {
    const r = await solve(model, plates, backend);
    expect(r.status).toBe('ok');
    expect(r.recipes.map((x) => x.id)).toEqual(['mine-ore', 'slow']);
    expect(machines(r, 'slow')).toBeCloseTo(10, 9);
    expect(r.stats.pruned).toEqual(['fast']);
    for (const s of r.stages) expect(s.value).toBeLessThanOrEqual(s.optimum * (1 + 1e-4) + 1e-9);
  });

  test('a small branch the plan needs is kept', async () => {
    // 0.005 plates/min takes 0.005 machines of `slow` (or less of `fast`):
    // one of them has to run, however small.
    const r = await solve(
      model,
      { ...plates, targets: [{ item: 'plate', rate: 0.005 }], recipes: { exclude: ['fast'] } },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(machines(r, 'slow')).toBeCloseTo(0.005, 9);
    expect(r.stats.pruned).toBeUndefined();
  });

  test('with a larger threshold, a needed branch below it stays', async () => {
    // The miner runs 1/6 machine, under 0.5, but the plan can't do without it.
    const r = await solve(model, { ...plates, minBranch: 0.5 }, backend);
    expect(r.status).toBe('ok');
    expect(machines(r, 'mine-ore')).toBeCloseTo(1 / 6, 9);
    expect(machines(r, 'fast')).toBeUndefined();
    expect(r.stats.pruned).toEqual(['fast']);
  });

  test('is deterministic', async () => {
    const a = await solve(model, plates, backend);
    const b = await solve(model, plates, backend);
    expect(b).toEqual(a);
  });

  test('a negative or non-finite threshold is rejected', async () => {
    for (const minBranch of [-0.01, Number.NaN, Infinity]) {
      const r = await solve(model, { ...plates, minBranch }, backend);
      expect(r.status).toBe('error');
      expect(r.diagnostics[0]!.code).toBe('invalid-request');
    }
  });
});

/**
 * The flow prune (A68). A gem makes two plates, but only 0.0009 gems/min may
 * be mined: the resources optimum takes all of them, so the plan carries a
 * 0.0009/min gem branch. Dropping it costs about 1.8% more ore, past the
 * 0.01% lock, so the prune pass must keep it; the flow prune re-solves
 * without it.
 */
const gems: Model = {
  ...model,
  items: [...model.items, { id: 'gem', name: 'gem', form: 'solid', sinkPoints: 0, tier: '0-0' }],
  recipes: [
    ...model.recipes,
    base('mine-gem', {
      kind: 'extraction',
      outputs: [{ item: 'gem', rate: 60 }],
      powerMW: 5,
      node: 'node:gem:normal',
    }),
    base('gem-plate', {
      inputs: [{ item: 'gem', rate: 1 }],
      outputs: [{ item: 'plate', rate: 2 }],
    }),
  ],
  nodes: [
    ...model.nodes,
    { id: 'node:gem:normal', resource: 'gem', purity: 'normal', count: 100, nne: 1 },
  ],
};
const gemPlates: SolveRequest = {
  targets: [{ item: 'plate', rate: 0.1 }],
  objectives: ['resources'],
  resourceLimits: { gem: 0.0009 },
  recipes: { exclude: ['fast'] },
};
const flow = (r: SolveResult, id: string, item: string) =>
  r.recipes.find((x) => x.id === id)?.outputs.find((f) => f.item === item)?.rate;

describe('flow prune (A68)', () => {
  test('without it, the plan keeps a gem branch below 0.001/min', async () => {
    const r = await solve(gems, { ...gemPlates, minFlow: 0 }, backend);
    expect(r.status).toBe('ok');
    expect(flow(r, 'mine-gem', 'gem')).toBeCloseTo(0.0009, 9);
    expect(flow(r, 'gem-plate', 'plate')).toBeCloseTo(0.0018, 9);
    expect(r.stats.pruned).toBeUndefined();
  });

  test('by default, the branch is dropped and the plan re-solved without it', async () => {
    const r = await solve(gems, gemPlates, backend);
    expect(r.status).toBe('ok');
    expect(r.recipes.map((x) => x.id)).toEqual(['mine-ore', 'slow']);
    expect(flow(r, 'slow', 'plate')).toBeCloseTo(0.1, 9);
    expect(r.stats.pruned).toEqual(['gem-plate', 'mine-gem']);
    for (const x of r.recipes)
      for (const f of [...x.inputs, ...x.outputs]) expect(f.rate).toBeGreaterThanOrEqual(MIN_FLOW);
  });

  test('a flow the plan needs is kept', async () => {
    // A target below the threshold has to be made, however small.
    const r = await solve(
      gems,
      { ...gemPlates, targets: [{ item: 'plate', rate: 0.0005 }] },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(flow(r, 'gem-plate', 'plate') ?? flow(r, 'slow', 'plate')).toBeCloseTo(0.0005, 9);
    expect(r.items.find((f) => f.item === 'plate')?.demand).toBeCloseTo(0.0005, 12);
  });

  /**
   * `smelt` makes `plates` plates per machine from as much ore and 1 flux,
   * imported up to 2.5/min, and leaves 0.0001 slag/min over per machine;
   * `slow` makes the rest. The machines optimum runs `smelt` flat out.
   */
  const slag = (plates: number): Model => ({
    ...model,
    items: [
      ...model.items,
      ...['flux', 'slag'].map((id) => ({
        id,
        name: id,
        form: 'solid' as const,
        sinkPoints: 0,
        tier: '0-0',
      })),
    ],
    recipes: [
      ...model.recipes.filter((r) => r.id !== 'fast'),
      base('smelt', {
        inputs: [
          { item: 'ore', rate: plates },
          { item: 'flux', rate: 1 },
        ],
        outputs: [
          { item: 'plate', rate: plates },
          { item: 'slag', rate: 0.0001 },
        ],
      }),
    ],
  });
  const fivePlates: SolveRequest = {
    targets: [{ item: 'plate', rate: 5 }],
    imports: [{ item: 'flux', cap: 2.5 }],
    objectives: ['machines'],
  };

  test('a tiny surplus is dropped when doing without it costs under 1%', async () => {
    // `smelt` saves under 1% of the machines, for 0.0001 slag/min left over.
    const m = slag(1.01);
    const off = await solve(m, { ...fivePlates, minFlow: 0 }, backend);
    expect(off.status).toBe('ok');
    expect(off.surplus.map((f) => f.item)).toEqual(['slag']);
    expect(off.surplus[0]!.rate).toBeLessThan(MIN_FLOW);
    const on = await solve(m, fivePlates, backend);
    expect(on.status).toBe('ok');
    expect(on.surplus).toEqual([]);
    expect(on.imports).toEqual([]);
    expect(on.recipes.map((x) => x.id)).toEqual(['mine-ore', 'slow']);
    expect(on.stats.pruned).toEqual(['smelt']);
  });

  test('a drop that costs more than 1% is not made', async () => {
    // Here `smelt` saves half its share of the machines.
    const m = slag(2);
    const on = await solve(m, fivePlates, backend);
    const off = await solve(m, { ...fivePlates, minFlow: 0 }, backend);
    expect(on).toEqual(off);
    expect(on.surplus.map((f) => f.item)).toEqual(['slag']);
  });

  test('is deterministic', async () => {
    const a = await solve(gems, gemPlates, backend);
    const b = await solve(gems, gemPlates, backend);
    expect(b).toEqual(a);
  });

  test('a negative or non-finite threshold is rejected', async () => {
    for (const minFlow of [-0.001, Number.NaN, Infinity]) {
      const r = await solve(gems, { ...gemPlates, minFlow }, backend);
      expect(r.status).toBe('error');
      expect(r.diagnostics[0]!.code).toBe('invalid-request');
    }
  });
});
