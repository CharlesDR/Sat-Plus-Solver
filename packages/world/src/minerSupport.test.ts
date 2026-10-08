import type { Model, Recipe } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import { MINER_SUPPORT_NAME, unwiredMinerNeeds, wireMinerSupport } from './helpers';
import { resolveWorld } from './resolve';
import { buildWorld } from './testing';
import type { SolveFactory } from './types';

/** Gem can only be mined with water (10/min per miner); a pump makes water. */
const recipe = (id: string, extra: Partial<Recipe>): Recipe => ({
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
  meta: { schemaVersion: 2, dataHash: 'miner-support', minerMk: 3 },
  items: [
    { id: 'gem', form: 'solid' as const },
    { id: 'water', form: 'fluid' as const },
  ].map((i) => ({ ...i, name: i.id, sinkPoints: 0, tier: '0-0' })),
  machines: [],
  recipes: [
    recipe('mine:gem:normal:raw:water', {
      kind: 'extraction',
      source: 'generated',
      node: 'node:gem:normal',
      inputs: [{ item: 'water', rate: 10 }],
      outputs: [{ item: 'gem', rate: 60 }],
      route: { resource: 'gem', purity: 'normal', processing: null, fluid: 'water' },
    }),
    recipe('pump', { outputs: [{ item: 'water', rate: 120 }] }),
  ],
  nodes: [{ id: 'node:gem:normal', resource: 'gem', purity: 'normal', count: 100, nne: 1 }],
  beltCapacities: [],
};
const backend = createHighsBackend();
const solveFactory: SolveFactory = (r) => solve(model, r, backend);

describe('Miner support (A71)', () => {
  test('one click makes the factory and pulls the supplied fluid, so nothing is unmet', async () => {
    const world = buildWorld([
      {
        id: 'mine',
        targets: [{ item: 'gem', rate: 120 }],
        request: { minerFluidSupply: 'outside', objectives: ['resources'] },
      },
    ]);
    const before = await resolveWorld(world, model, solveFactory);
    const needs = {
      factories: before.factories.map((f) => ({ id: f.id, minerSupply: f.result.minerSupply })),
    };
    expect(needs.factories[0]!.minerSupply).toEqual([{ item: 'water', rate: 20 }]);
    expect(unwiredMinerNeeds(world, needs)).toEqual([{ to: 'mine', item: 'water' }]);

    const wired = wireMinerSupport(world, needs);
    const support = wired.world.factories.find((f) => f.id === wired.factoryId)!;
    expect(support.name).toBe(MINER_SUPPORT_NAME);
    expect(support.request.minerFluidSupply).toBe('local');
    expect(wired.world.links).toEqual([
      { id: wired.links[0], from: support.id, to: 'mine', item: 'water', mode: { kind: 'pull' } },
    ]);
    // A second click finds the factory and the link, and adds nothing.
    expect(unwiredMinerNeeds(wired.world, needs)).toEqual([]);
    const again = wireMinerSupport(wired.world, needs);
    expect(again.factoryId).toBe(wired.factoryId);
    expect(again.world.links).toHaveLength(1);

    const after = await resolveWorld(wired.world, model, solveFactory);
    const row = (id: string) => after.factories.find((f) => f.id === id)!.ledger;
    expect(row('mine').find((r) => r.item === 'water')).toMatchObject({ imported: 20, unmet: 0 });
    expect(row(support.id).find((r) => r.item === 'water')).toMatchObject({
      produced: 20,
      exported: 20,
    });
    expect(after.links[0]).toMatchObject({ id: wired.links[0], used: 20 });
  });
});
