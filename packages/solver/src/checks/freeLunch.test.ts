import { MW_ITEM_ID, type Model, type Recipe } from '@sps/data';
import { describe, expect, test } from 'vitest';
import { createHighsBackend } from '../lp/highs';
import { findFreeLunch } from './freeLunch';

const backend = createHighsBackend();

function recipe(
  id: string,
  inputs: [string, number][],
  outputs: [string, number][],
  powerMW = 0,
  extra: Partial<Recipe> = {},
): Recipe {
  return {
    id,
    name: id,
    machine: 'm',
    kind: outputs.some(([i]) => i === MW_ITEM_ID) ? 'generator' : 'production',
    alternate: false,
    tier: '0-0',
    inputs: inputs.map(([item, rate]) => ({ item, rate })),
    outputs: outputs.map(([item, rate]) => ({ item, rate })),
    powerMW,
    clock: 1,
    source: 'dataset',
    ...extra,
  };
}

const model = (recipes: Recipe[]): Model => ({
  meta: { schemaVersion: 1, dataHash: 'test', minerMk: 3 },
  items: [],
  machines: [],
  recipes,
  nodes: [],
  beltCapacities: [],
});

describe('findFreeLunch', () => {
  test('a balanced chain is not a free lunch', async () => {
    const r = await findFreeLunch(
      model([
        recipe('plate', [['ingot', 30]], [['plate', 20]], 4),
        recipe('smelt', [['ore', 30]], [['ingot', 30]], 4),
      ]),
      backend,
    );
    expect(r.found).toBe(false);
  });

  test('a loop that multiplies an item is found', async () => {
    const r = await findFreeLunch(
      model([
        recipe('a-to-b', [['a', 10]], [['b', 20]]),
        recipe('b-to-a', [['b', 10]], [['a', 10]]),
      ]),
      backend,
    );
    expect(r.found).toBe(true);
    expect(r.recipes.map((x) => x.id).sort()).toEqual(['a-to-b', 'b-to-a']);
    expect(r.items.map((i) => i.id)).toContain('b');
  });

  test('a power loop that nets generation is found', async () => {
    // Recharging costs 100 MW; burning the charge yields 400 MW: +300 MW from nothing.
    const r = await findFreeLunch(
      model([
        recipe('recharge', [['spent', 6]], [['charged', 6]], 100),
        recipe(
          'burn',
          [['charged', 6]],
          [
            ['spent', 6],
            [MW_ITEM_ID, 400],
          ],
          -400,
        ),
      ]),
      backend,
    );
    expect(r.found).toBe(true);
    expect(r.items).toEqual([{ id: MW_ITEM_ID, net: expect.closeTo(300, 6) }]);
  });

  test('a power loop whose machines draw more than it generates is not (SF+ slime turbines)', async () => {
    // Particle Accelerator: 30 spent → 30 energized per min at 2000 MW; turbine: 9 → 9 for 400 MW.
    const r = await findFreeLunch(
      model([
        recipe('supercharge', [['spent', 30]], [['energized', 30]], 2000),
        recipe(
          'turbine',
          [['energized', 9]],
          [
            ['spent', 9],
            [MW_ITEM_ID, 400],
          ],
          -400,
        ),
      ]),
      backend,
    );
    expect(r.found).toBe(false);
  });

  test('whitelisted recipes and node-limited extraction are ignored', async () => {
    const loop = [
      recipe('a-to-b', [['a', 10]], [['b', 20]]),
      recipe('b-to-a', [['b', 10]], [['a', 10]]),
    ];
    expect((await findFreeLunch(model(loop), backend, new Set(['a-to-b']))).found).toBe(false);
    const mining = recipe('miner', [['slime', 30]], [['ore', 1800]], 60, {
      node: 'node:ore:pure',
      kind: 'extraction',
    });
    const recycle = recipe('slime', [['ore', 10]], [['slime', 30]]);
    expect((await findFreeLunch(model([mining, recycle]), backend)).found).toBe(false);
  });

  /** A heater (A17): fuel f → exhaust x on the heater side, water → 2 steam on the boiler side. */
  const heater = (): Recipe => ({
    ...recipe('heater', [], []),
    heater: true,
    inputs: [
      { item: 'water', rate: 20 },
      { item: 'f', rate: 10, heater: true },
    ],
    outputs: [
      { item: 'steam', rate: 40 },
      { item: 'x', rate: 10, heater: true },
    ],
  });

  test('a heater can burn with its boiler idle, so a fuel loop through its exhaust is found (A17)', async () => {
    // No water source: only the heater side can run, and x → f multiplies fuel.
    const r = await findFreeLunch(
      model([heater(), recipe('x-to-f', [['x', 10]], [['f', 12]])]),
      backend,
    );
    expect(r.found).toBe(true);
    expect(r.recipes.map((x) => x.id).sort()).toEqual(['heater', 'x-to-f']);
    expect(r.items.map((i) => i.id)).toEqual(['f']);
  });

  test('a boiler never runs without its heater burning fuel (A17)', async () => {
    // Steam → water closes the boiler loop with steam to spare, but fuel f has no source.
    const r = await findFreeLunch(
      model([heater(), recipe('condense', [['steam', 10]], [['water', 10]])]),
      backend,
    );
    expect(r.found).toBe(false);
  });
});
