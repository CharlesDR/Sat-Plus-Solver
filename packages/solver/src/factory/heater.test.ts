import type { Model, Recipe } from '@sps/data';
import { describe, expect, test } from 'vitest';
import { createHighsBackend } from '../lp/highs';
import { MIN_RATE, solve } from './solve';
import type { SolveResult } from './types';

/**
 * Heater/boiler recipes (A17): fuel and exhaust run at 100% per whole heater,
 * the boiler pair scales with throughput. Numbers follow Solid Fuel Heater
 * Mk.1 (Coal) and Solution Heater Mk.1 (Hydrogen) from the SF+ dataset.
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
  meta: { schemaVersion: 2, dataHash: 'heater', minerMk: 1 },
  items: ['coal', 'water', 'steam', 'flue-gas', 'hydrogen'].map((id) => ({
    id,
    name: id,
    form: id === 'coal' ? ('solid' as const) : ('fluid' as const),
    sinkPoints: 0,
    tier: '0-0',
  })),
  machines: [],
  recipes: [
    base('mine-coal', {
      kind: 'extraction',
      outputs: [{ item: 'coal', rate: 60 }],
      powerMW: 5,
      node: 'node:coal:normal',
    }),
    base('water', { kind: 'extraction', outputs: [{ item: 'water', rate: 120 }], powerMW: 20 }),
    base('coal-heater', {
      heater: true,
      inputs: [
        { item: 'water', rate: 20 },
        { item: 'coal', rate: 15, heater: true },
      ],
      outputs: [
        { item: 'steam', rate: 40 },
        { item: 'flue-gas', rate: 15, heater: true },
      ],
    }),
    base('hydrogen-heater', {
      heater: true,
      inputs: [
        { item: 'water', rate: 50 },
        { item: 'hydrogen', rate: 60, heater: true },
      ],
      outputs: [
        { item: 'steam', rate: 100 },
        { item: 'water', rate: 15, heater: true },
      ],
    }),
  ],
  nodes: [{ id: 'node:coal:normal', resource: 'coal', purity: 'normal', count: 100, nne: 1 }],
  beltCapacities: [],
};

const usage = (r: SolveResult, id: string) => r.recipes.find((x) => x.id === id);
const flow = (r: SolveResult, item: string) => r.items.find((x) => x.item === item);
const rate = (list: { item: string; rate: number }[], item: string) =>
  list.find((x) => x.item === item)?.rate ?? 0;

describe('heaters (A17)', () => {
  test('20 Steam/min: one heater burns its full 15 Coal; the boiler runs at 50%', async () => {
    const r = await solve(model, { targets: [{ item: 'steam', rate: 20 }] }, backend);
    expect(r.status).toBe('ok');
    const h = usage(r, 'coal-heater')!;
    expect(h.machines).toBe(1);
    expect(h.machinesCeil).toBe(1);
    expect(h.boilerLoad).toBeCloseTo(0.5, 9);
    expect(flow(r, 'coal')!.consumed).toBeCloseTo(15, 9);
    expect(rate(r.surplus, 'flue-gas')).toBeCloseTo(15, 9);
    // Only the water the boiler needs, and no steam dumped.
    expect(flow(r, 'water')!.consumed).toBeCloseTo(10, 9);
    expect(rate(r.surplus, 'steam')).toBe(0);
    expect(usage(r, 'water')!.machines).toBeCloseTo(10 / 120, 9);
  });

  test('recipe flows carry the heater split: fuel and exhaust whole, boiler at load', async () => {
    const r = await solve(model, { targets: [{ item: 'steam', rate: 20 }] }, backend);
    const h = usage(r, 'coal-heater')!;
    expect(h.inputs).toEqual([
      { item: 'water', rate: expect.closeTo(10, 9) },
      { item: 'coal', rate: 15 },
    ]);
    expect(h.outputs).toEqual([
      { item: 'steam', rate: expect.closeTo(20, 9) },
      { item: 'flue-gas', rate: 15 },
    ]);
    expect(usage(r, 'mine-coal')!.node).toBe('node:coal:normal');
    // The flows add up to each item's produced and consumed totals.
    for (const f of r.items) {
      const sum = (side: 'inputs' | 'outputs') =>
        r.recipes.reduce((s, x) => s + rate(x[side], f.item), 0);
      expect(sum('outputs')).toBeCloseTo(f.produced, 9);
      expect(sum('inputs')).toBeCloseTo(f.consumed, 9);
    }
  });

  test('1 Steam/min still burns a whole heater of fuel and emits its whole exhaust', async () => {
    const r = await solve(model, { targets: [{ item: 'steam', rate: 1 }] }, backend);
    expect(usage(r, 'coal-heater')!.machines).toBe(1);
    expect(flow(r, 'coal')!.consumed).toBeCloseTo(15, 9);
    expect(rate(r.surplus, 'flue-gas')).toBeCloseTo(15, 9);
    // O1 pays for the coal: 15/60 of a normal coal node.
    expect(r.objectiveValue).toBeCloseTo(0.25, 9);
  });

  test('300 Steam/min: 8 heaters (rounded up), fuel for 8, boiler at 300/320', async () => {
    const r = await solve(model, { targets: [{ item: 'steam', rate: 300 }] }, backend);
    const h = usage(r, 'coal-heater')!;
    expect(h.machines).toBe(8);
    expect(h.boilerLoad).toBeCloseTo(300 / 320, 9);
    expect(flow(r, 'coal')!.consumed).toBeCloseTo(8 * 15, 9);
    expect(rate(r.surplus, 'flue-gas')).toBeCloseTo(8 * 15, 9);
    expect(flow(r, 'water')!.consumed).toBeCloseTo(150, 9);
  });

  test('a heater can run for its exhaust alone, with the boiler idle', async () => {
    const r = await solve(model, { targets: [{ item: 'flue-gas', rate: 30 }] }, backend);
    expect(r.status).toBe('ok');
    const h = usage(r, 'coal-heater')!;
    expect(h.machines).toBe(2);
    expect(h.boilerLoad).toBe(0);
    expect(flow(r, 'water')).toBeUndefined();
    expect(flow(r, 'steam')).toBeUndefined();
  });

  test('exhaust is reachable from the fuel alone, without the boiler input', async () => {
    const noWater = { ...model, recipes: model.recipes.filter((x) => x.id !== 'water') };
    const r = await solve(noWater, { targets: [{ item: 'flue-gas', rate: 15 }] }, backend);
    expect(r.status).toBe('ok');
    expect(usage(r, 'coal-heater')!.machines).toBe(1);
  });

  test('boiler water and exhaust water stay apart (Hydrogen heater)', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'steam', rate: 50 }],
        imports: [{ item: 'hydrogen', cap: Infinity }],
        recipes: { exclude: ['coal-heater'] },
      },
      backend,
    );
    const h = usage(r, 'hydrogen-heater')!;
    expect(h.machines).toBe(1);
    expect(h.boilerLoad).toBeCloseTo(0.5, 9);
    expect(rate(r.imports, 'hydrogen')).toBeCloseTo(60, 9);
    // 25 Water into the boiler; the 15 exhaust Water covers part of it.
    const water = flow(r, 'water')!;
    expect(water.consumed).toBeCloseTo(25, 9);
    expect(water.produced).toBeCloseTo(15 + 10, 9);
    expect(usage(r, 'water')!.machines).toBeCloseTo(10 / 120, 9);
  });

  test('a heater count that exceeds the fuel available is infeasible, and the relaxation is whole', async () => {
    // One normal coal node gives 60 Coal/min: 4 heaters. 170 Steam needs 5.
    const r = await solve(
      model,
      { targets: [{ item: 'steam', rate: 170 }], nodeBudget: { 'node:coal:normal': 1 } },
      backend,
    );
    expect(r.status).toBe('infeasible');
    const d = r.diagnostics[0]!;
    if (d.code !== 'infeasible') throw new Error(d.code);
    // 5 heaters burn 75 Coal: 0.25 more nodes, not the 0.0625 a fractional heater would need.
    expect(d.relaxations).toEqual([
      { kind: 'node', node: 'node:coal:normal', amount: expect.closeTo(0.25, 9) },
    ]);
  });

  test('a 1e-6/min demand still needs whole heaters: no plan "meets" it with nothing built', async () => {
    // Found by the random heater property test. At HiGHS's default 1e-6 MIP
    // tolerance this demand looked met with no heater; really the second
    // heater needs a whole 4/min of imported fuel, and only 0.25 is allowed.
    const tiny: Model = {
      ...model,
      items: ['i0', 'i1', 'i2', 'i3', 'i4'].map((id) => ({
        id,
        name: id,
        form: 'solid' as const,
        sinkPoints: 0,
        tier: '0-0',
      })),
      recipes: [
        base('mine-0', {
          kind: 'extraction',
          outputs: [{ item: 'i0', rate: 60 }],
          powerMW: 1,
          node: 'node:i0',
        }),
        base('r0', { inputs: [{ item: 'i0', rate: 5 }], outputs: [{ item: 'i1', rate: 7 }] }),
        base('r4', {
          heater: true,
          inputs: [
            { item: 'i0', rate: 14 },
            { item: 'i3', rate: 4, heater: true },
          ],
          outputs: [{ item: 'i2', rate: 31 }],
        }),
        base('r8', {
          heater: true,
          inputs: [
            { item: 'i2', rate: 39 },
            { item: 'i1', rate: 30, heater: true },
          ],
          outputs: [{ item: 'i4', rate: 51 }],
        }),
      ],
      nodes: [{ id: 'node:i0', resource: 'i0', purity: 'normal', count: 1, nne: 1 }],
    };
    const r = await solve(
      tiny,
      { targets: [{ item: 'i4', rate: 1e-6 }], imports: [{ item: 'i3', cap: 0.25 }] },
      backend,
    );
    expect(r.status).toBe('infeasible');
    const d = r.diagnostics[0]!;
    if (d.code !== 'infeasible') throw new Error(d.code);
    expect(d.relaxations).toEqual([
      { kind: 'import', item: 'i3', amount: expect.closeTo(3.75, 9) },
    ]);
    const fixed = await solve(
      tiny,
      { targets: [{ item: 'i4', rate: 1e-6 }], imports: [{ item: 'i3', cap: 4 }] },
      backend,
    );
    expect(fixed.status).toBe('ok');
    expect(usage(fixed, 'r4')!.machines).toBe(1);
    expect(usage(fixed, 'r8')!.machines).toBe(1);
  });

  test('is deterministic', async () => {
    const req = { targets: [{ item: 'steam', rate: 70 }] };
    expect(await solve(model, req, backend)).toEqual(await solve(model, req, backend));
  });

  test('O3 counts a heater as a whole machine, not its boiler load (M4)', async () => {
    const r = await solve(
      model,
      { targets: [{ item: 'steam', rate: 20 }], objective: 'machines' },
      backend,
    );
    expect(usage(r, 'coal-heater')!.boilerLoad).toBeCloseTo(0.5, 9);
    // 1 heater + 10/120 water extractors + 15/60 coal miners.
    expect(r.objectiveValue).toBeCloseTo(1 + 10 / 120 + 0.25, 9);
  });

  test('an imported Steam is costed at the rate imported, not 1/min × rate (A18)', async () => {
    // This factory has no coal nodes, so all 300 Steam/min is imported. Its
    // standalone plan takes 8 heaters burning 120 Coal: 2 normal nodes. At
    // 1/min × 300 it would be charged 300 heaters' coal (75 nodes).
    const r = await solve(
      model,
      {
        targets: [{ item: 'steam', rate: 300 }],
        imports: [{ item: 'steam', cap: Infinity }],
        nodeBudget: { 'node:coal:normal': 0 },
        costImports: true,
      },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(r.objectiveValue).toBeCloseTo(2, 9);
    expect(r.importCosts).toEqual([
      {
        item: 'steam',
        rate: expect.closeTo(300, 9),
        cost: { resources: expect.closeTo(2 / 300, 12) },
        resourceTypes: ['coal'],
      },
    ]);
    expect(rate(r.imports, 'steam')).toBeCloseTo(300, 9);
    expect(r.diagnostics).toEqual([]);
  });

  test('when importing competes with local heaters, the plan is costed at its own import rate', async () => {
    // Local heaters and imports cost the same per whole heater, so 300 Steam/min
    // costs 2 nodes however it is split; the import is charged for its own rate.
    const r = await solve(
      model,
      {
        targets: [{ item: 'steam', rate: 300 }],
        imports: [{ item: 'steam', cap: Infinity }],
        costImports: true,
      },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(r.objectiveValue).toBeCloseTo(2, 9);
    const c = r.importCosts![0]!;
    const s = rate(r.imports, 'steam');
    // An import the plan stops using keeps the rate it was last costed at.
    if (s >= MIN_RATE) expect(c.rate).toBeCloseTo(s, 9);
    expect(c.cost.resources! * c.rate).toBeCloseTo(Math.ceil(c.rate / 40 - 1e-9) * 0.25, 9);
  });

  test('an import the plan does not use is costed at 1/min: a whole heater for 1 Steam', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'flue-gas', rate: 15 }],
        imports: [{ item: 'steam', cap: Infinity }],
        costImports: true,
      },
      backend,
    );
    expect(r.imports).toEqual([]);
    expect(r.importCosts).toEqual([
      { item: 'steam', rate: 1, cost: { resources: 0.25 }, resourceTypes: ['coal'] },
    ]);
  });
});
