import type { Model, Recipe } from '@sps/data';
import { describe, expect, test } from 'vitest';
import { createHighsBackend } from '../lp/highs';
import { filterMinerRoutes, minerFluidOptions } from './minerFluids';
import { solve } from './solve';
import type { SolveRequest } from './types';

/**
 * Miner fluids (A69). Ore has a plain route (60/min) and a slime route that
 * doubles it for 10 slime/min; gem has no plain route, only water or slime.
 * Slime is made from ore by `brew`, at 1 ore per slime.
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
const miner = (resource: string, fluid: string | null, rate: number): Recipe =>
  base(`mine:${resource}:normal:raw:${fluid ?? 'dry'}`, {
    kind: 'extraction',
    source: 'generated',
    node: `node:${resource}:normal`,
    inputs: fluid ? [{ item: fluid, rate: 10 }] : [],
    outputs: [{ item: resource, rate }],
    route: { resource, purity: 'normal', processing: null, fluid },
  });

const model: Model = {
  meta: { schemaVersion: 2, dataHash: 'miner-fluids', minerMk: 3 },
  items: [
    ...['ore', 'gem'].map((id) => ({ id, form: 'solid' as const })),
    ...['water', 'slime'].map((id) => ({ id, form: 'fluid' as const })),
  ].map((i) => ({ ...i, name: i.id, sinkPoints: 0, tier: '0-0' })),
  machines: [],
  recipes: [
    miner('ore', null, 60),
    miner('ore', 'slime', 120),
    miner('gem', 'water', 60),
    miner('gem', 'slime', 120),
    base('pump', { outputs: [{ item: 'water', rate: 120 }] }),
    base('brew', { inputs: [{ item: 'ore', rate: 10 }], outputs: [{ item: 'slime', rate: 10 }] }),
  ],
  nodes: [
    { id: 'node:ore:normal', resource: 'ore', purity: 'normal', count: 100, nne: 1 },
    { id: 'node:gem:normal', resource: 'gem', purity: 'normal', count: 100, nne: 1 },
  ],
  beltCapacities: [],
};
const ids = (rs: readonly Recipe[]) => rs.map((r) => r.id);
const ore: SolveRequest = { targets: [{ item: 'ore', rate: 240 }], objectives: ['resources'] };

describe('miner fluids (A69)', () => {
  test('options come from the data: which ores have a plain route, and their fluids', () => {
    expect(Object.fromEntries(minerFluidOptions(model.recipes))).toEqual({
      ore: { plain: true, fluids: ['slime'] },
      gem: { plain: false, fluids: ['slime', 'water'] },
    });
  });

  test('none keeps plain routes, and water for an ore that needs a fluid', () => {
    expect(ids(filterMinerRoutes(model.recipes, 'none'))).toEqual([
      'mine:ore:normal:raw:dry',
      'mine:gem:normal:raw:water',
      'pump',
      'brew',
    ]);
  });

  test('water keeps water routes too; any keeps them all', () => {
    expect(ids(filterMinerRoutes(model.recipes, 'water'))).toEqual(
      ids(filterMinerRoutes(model.recipes, 'none')),
    );
    expect(ids(filterMinerRoutes(model.recipes, 'any'))).toEqual(ids(model.recipes));
  });

  test('made here, the slime route brings its slime chain into the plan', async () => {
    const r = await solve(model, ore, backend);
    expect(r.status).toBe('ok');
    expect(ids(r.recipes as never)).toContain('brew');
    expect(r.minerSupply).toBeUndefined();
  });

  test('without fluid modules, only the plain route runs', async () => {
    const r = await solve(model, { ...ore, minerFluids: 'none' }, backend);
    expect(r.status).toBe('ok');
    expect(r.recipes.map((x) => x.id)).toEqual(['mine:ore:normal:raw:dry']);
  });

  test('supplied from outside, the slime is an import of its own, costed', async () => {
    const r = await solve(model, { ...ore, minerFluidSupply: 'outside' }, backend);
    expect(r.status).toBe('ok');
    expect(r.recipes.map((x) => x.id)).not.toContain('brew');
    const slime = r.minerSupply?.find((f) => f.item === 'slime');
    expect(slime?.rate).toBeGreaterThan(0);
    expect(r.imports).toContainEqual(slime);
    // The miners' input is reported as slime, balanced by the supply.
    const flow = r.items.find((f) => f.item === 'slime')!;
    expect(flow.imported).toBeCloseTo(flow.consumed, 9);
    // The supply's cost (an ore miner's share per slime) shows in the objective.
    expect(r.stages[0]!.value).toBeGreaterThan(0);
  });

  test('outside supply is not used by other recipes', async () => {
    const r = await solve(
      model,
      { targets: [{ item: 'slime', rate: 10 }], minerFluidSupply: 'outside' },
      backend,
    );
    expect(r.status).toBe('ok');
    // The target is brewed here; only the miners draw on the supply.
    const flow = r.items.find((f) => f.item === 'slime')!;
    expect(flow.produced).toBeCloseTo(10, 9);
    expect(flow.imported).toBeCloseTo(r.minerSupply?.[0]?.rate ?? 0, 9);
  });

  test('an unknown setting is rejected', async () => {
    const r = await solve(model, { ...ore, minerFluids: 'some' as never }, backend);
    expect(r.status).toBe('error');
  });
});
