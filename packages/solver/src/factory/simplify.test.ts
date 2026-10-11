import type { Model, Recipe } from '@sps/data';
import { describe, expect, test } from 'vitest';
import { createHighsBackend } from '../lp/highs';
import { SIMPLICITY_CAP, solve } from './solve';
import type { SolveRequest, SolveResult } from './types';

/**
 * The simplicity pass (A73). Plates come from ore one of three ways: `plate`
 * (2 ore each), `plate-boosted` (0.5% less ore, plus a sliver of `boost` from
 * a gem miner and `make-boost`, both well under 1% of a machine), and
 * `plate-rich` (5% less ore with the same sliver). `plate` also leaves slag,
 * which `recycle` turns back into ore, saving 0.5%.
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

const item = (id: string, form: 'solid' | 'fluid' | 'power' = 'solid') => ({
  id,
  name: id,
  form,
  sinkPoints: 0,
  tier: '0-0',
});

const model: Model = {
  meta: { schemaVersion: 2, dataHash: 'simplify', minerMk: 1 },
  items: [item('ore'), item('gem'), item('boost'), item('plate'), item('slag')],
  machines: [],
  recipes: [
    base('mine-ore', {
      kind: 'extraction',
      outputs: [{ item: 'ore', rate: 60 }],
      node: 'node:ore:normal',
    }),
    base('mine-gem', {
      kind: 'extraction',
      outputs: [{ item: 'gem', rate: 6000 }],
      node: 'node:gem:normal',
    }),
    base('make-boost', {
      inputs: [{ item: 'gem', rate: 1000 }],
      outputs: [{ item: 'boost', rate: 1000 }],
    }),
    base('plate', {
      inputs: [{ item: 'ore', rate: 20 }],
      outputs: [
        { item: 'plate', rate: 10 },
        { item: 'slag', rate: 10 },
      ],
    }),
    base('plate-boosted', {
      inputs: [
        { item: 'ore', rate: 19.9 },
        { item: 'boost', rate: 0.01 },
      ],
      outputs: [{ item: 'plate', rate: 10 }],
    }),
    base('plate-rich', {
      inputs: [
        { item: 'ore', rate: 19 },
        { item: 'boost', rate: 0.01 },
      ],
      outputs: [{ item: 'plate', rate: 10 }],
    }),
    base('recycle', {
      inputs: [{ item: 'slag', rate: 10 }],
      outputs: [{ item: 'ore', rate: 0.1 }],
    }),
  ],
  nodes: [
    { id: 'node:ore:normal', resource: 'ore', purity: 'normal', count: 1000, nne: 1 },
    { id: 'node:gem:normal', resource: 'gem', purity: 'normal', count: 1000, nne: 1 },
  ],
  beltCapacities: [],
};

const plates = (exclude: string[], rate = 10): SolveRequest => ({
  targets: [{ item: 'plate', rate }],
  objectives: ['resources'],
  recipes: { exclude },
});

const ids = (r: SolveResult) => r.recipes.map((x) => x.id);

/** Every stage within SIMPLICITY_CAP of the plan solved without simplicity. */
function withinCap(r: SolveResult, without: SolveResult) {
  for (const [k, s] of r.stages.entries()) {
    const was = without.stages[k]!.value;
    expect(s.value).toBeLessThanOrEqual(was * (1 + SIMPLICITY_CAP) + 1e-9);
  }
}

describe('simplicity pass (A73)', () => {
  test('without it, the plan keeps a sliver chain that saves 0.5%', async () => {
    const r = await solve(model, plates(['plate-rich', 'recycle']), backend);
    expect(r.status).toBe('ok');
    expect(ids(r)).toEqual(['make-boost', 'mine-gem', 'mine-ore', 'plate-boosted']);
  });

  test('with it, the sliver chain goes and the plan is re-solved within 1%', async () => {
    const req = plates(['plate-rich', 'recycle']);
    const without = await solve(model, req, backend);
    const r = await solve(model, { ...req, simplicity: true }, backend);
    expect(r.status).toBe('ok');
    expect(ids(r)).toEqual(['mine-ore', 'plate']);
    expect(r.stats.pruned).toEqual(['make-boost', 'mine-gem', 'plate-boosted']);
    withinCap(r, without);
    // A fresh solution: the item balance holds on its own numbers.
    const plate = r.items.find((f) => f.item === 'plate')!;
    expect(plate.produced).toBeCloseTo(10, 9);
    expect(r.recipes.find((x) => x.id === 'mine-ore')!.machines).toBeCloseTo(20 / 60, 9);
  });

  test('a sliver that saves more than 1% stays', async () => {
    const r = await solve(
      model,
      { ...plates(['plate-boosted', 'recycle']), simplicity: true },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(ids(r)).toEqual(['make-boost', 'mine-gem', 'mine-ore', 'plate-rich']);
  });

  test('a whole step that saves 0.5% goes (fewest steps)', async () => {
    const req = plates(['plate-boosted', 'plate-rich']);
    const without = await solve(model, req, backend);
    expect(ids(without)).toEqual(['mine-ore', 'plate', 'recycle']);
    expect(without.recipes.find((x) => x.id === 'recycle')!.machines).toBeGreaterThan(0.9);
    const r = await solve(model, { ...req, simplicity: true }, backend);
    expect(ids(r)).toEqual(['mine-ore', 'plate']);
    expect(r.surplus).toEqual([{ item: 'slag', rate: 10 }]);
    withinCap(r, without);
  });

  test('works at small targets too', async () => {
    const req = { ...plates(['plate-rich', 'recycle'], 0.002), simplicity: true };
    const r = await solve(model, req, backend);
    expect(ids(r)).toEqual(['mine-ore', 'plate']);
  });

  test('is deterministic', async () => {
    const req = { ...plates(['plate-rich']), simplicity: true };
    expect(await solve(model, req, backend)).toEqual(await solve(model, req, backend));
  });
});

/**
 * C1 (A73): casting makes steam as a byproduct, and pressing takes water,
 * from a pump or from a turbine that turns 900 steam into 300 water.
 */
const steamModel: Model = {
  meta: { schemaVersion: 2, dataHash: 'steam', minerMk: 1 },
  items: [
    item('ore'),
    item('ingot'),
    item('plate'),
    item('steam', 'fluid'),
    item('water', 'fluid'),
    item('mw', 'power'),
  ],
  machines: [],
  recipes: [
    base('mine-ore', {
      kind: 'extraction',
      outputs: [{ item: 'ore', rate: 60 }],
      node: 'node:ore:normal',
    }),
    base('cast', {
      inputs: [{ item: 'ore', rate: 30 }],
      outputs: [
        { item: 'ingot', rate: 30 },
        { item: 'steam', rate: 30 },
      ],
    }),
    base('press', {
      inputs: [
        { item: 'ingot', rate: 30 },
        { item: 'water', rate: 30 },
      ],
      outputs: [{ item: 'plate', rate: 30 }],
    }),
    base('sell-ingot', {
      inputs: [{ item: 'ingot', rate: 30 }],
      outputs: [{ item: 'plate', rate: 1 }],
    }),
    base('pump', {
      kind: 'extraction',
      outputs: [{ item: 'water', rate: 180 }],
      powerMW: 20,
    }),
    base('turbine', {
      kind: 'generator',
      inputs: [{ item: 'steam', rate: 900 }],
      outputs: [
        { item: 'water', rate: 300 },
        { item: 'mw', rate: 10000 },
      ],
      powerMW: -10000,
    }),
  ],
  nodes: [{ id: 'node:ore:normal', resource: 'ore', purity: 'normal', count: 1000, nne: 1 }],
  beltCapacities: [],
};

describe('steam into water (C1, A73)', () => {
  test.each([0.5, 5, 10, 300])(
    'at %s plates/min, all the steam becomes water the plan uses',
    async (rate) => {
      const r = await solve(
        steamModel,
        { targets: [{ item: 'plate', rate }], recipes: { exclude: ['sell-ingot'] } },
        backend,
      );
      expect(r.status).toBe('ok');
      // `rate` steam makes rate / 3 water; the pump makes the rest.
      const turbine = r.recipes.find((x) => x.id === 'turbine')!;
      expect(turbine.machines).toBeCloseTo(rate / 900, 9);
      expect(r.recipes.find((x) => x.id === 'pump')!.machines).toBeCloseTo(
        (rate - rate / 3) / 180,
        9,
      );
      expect(r.surplus.find((s) => s.item === 'steam')).toBeUndefined();
    },
  );

  test('steam whose water would only be left over is dumped', async () => {
    const r = await solve(
      steamModel,
      { targets: [{ item: 'plate', rate: 1 }], recipes: { exclude: ['press'] } },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(r.recipes.map((x) => x.id)).toEqual(['cast', 'mine-ore', 'sell-ingot']);
    expect(r.surplus).toEqual([{ item: 'steam', rate: 30 }]);
  });
});
