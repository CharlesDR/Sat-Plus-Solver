import { describe, expect, test } from 'vitest';
import v1 from '../../../fixtures/worlds/v1-world.json';
import v2 from '../../../fixtures/worlds/v2-world.json';
import v3 from '../../../fixtures/worlds/v3-world.json';
import v4 from '../../../fixtures/worlds/v4-world.json';
import v5 from '../../../fixtures/worlds/v5-world.json';
import v6 from '../../../fixtures/worlds/v6-world.json';
import v7 from '../../../fixtures/worlds/v7-world.json';
import v8 from '../../../fixtures/worlds/v8-world.json';
import v10 from '../../../fixtures/worlds/v10-world.json';
import v11 from '../../../fixtures/worlds/v11-world.json';
import v12 from '../../../fixtures/worlds/v12-world.json';
import v9 from '../../../fixtures/worlds/v9-world.json';
import { WORLD_VERSION, createWorld, factorySolveRequest } from './document';
import { WorldMigrationError, migrateWorld } from './migrate';

describe('migrateWorld', () => {
  test('a v1 (M3) save migrates to the current version with both toggles off', () => {
    const before = JSON.stringify(v1);
    const w = migrateWorld(v1);
    expect(w.meta).toEqual({ v: WORLD_VERSION, dataHash: 'abc123' });
    expect(w.defaults).toEqual({
      // The old default stack moves to the new default (v5).
      objectives: ['scarcity'],
      tolerance: 0.0001,
      alternates: false,
      wholeMachines: false,
      costImports: false,
      // On, like a new world's (v8, A39).
      avoidFluidByproducts: true,
      recipes: { 'cast-screw': false },
      maxTier: null,
    });
    // The whole-pool budget becomes no resource limits (v4, A33); everything
    // else is carried over unchanged, and the input is untouched.
    expect(w.factories).toEqual(
      v1.factories.map(({ nodeBudget: _, ...f }) => ({ ...f, resources: {}, tweaks: [] })),
    );
    expect(w.nodePool).toEqual(v1.nodePool);
    expect(JSON.stringify(v1)).toBe(before);
  });

  test('a v2 (M5) save migrates exclusions to recipe toggles with the same effect', () => {
    const before = JSON.stringify(v2);
    const w = migrateWorld(v2);
    expect(w.meta.v).toBe(WORLD_VERSION);
    expect(w.defaults).toEqual({
      // The old default stack moves to the new default (v5).
      objectives: ['scarcity'],
      tolerance: 0.0001,
      alternates: false,
      wholeMachines: true,
      costImports: false,
      avoidFluidByproducts: true,
      recipes: { 'cast-screw': false },
      maxTier: null,
    });
    expect(w.factories[0]!.request).toEqual({
      targets: [{ item: 'iron-plate', rate: 60 }],
      objectives: ['scarcity'],
      recipes: { 'iron-wire': false },
    });
    expect(w.factories[1]!.request).toEqual(v2.factories[1]!.request);
    expect(w.factories.map(({ request: _, resources: __, ...f }) => f)).toEqual(
      v2.factories.map(({ request: _, nodeBudget: __, ...f }) => ({ ...f, tweaks: [] })),
    );
    // v2 unioned the world's and the factory's exclusions; v3 toggles give the same filter.
    const model = { nodes: [] };
    expect(factorySolveRequest(w, model, 'factory-main').recipes).toEqual({
      alternates: false,
      exclude: ['cast-screw', 'iron-wire'],
    });
    expect(factorySolveRequest(w, model, 'factory-b').recipes).toEqual({
      alternates: false,
      exclude: ['cast-screw'],
    });
    expect(JSON.stringify(v2)).toBe(before);
  });

  test('a v3 save trades node budgets for resource limits (A33)', () => {
    const before = JSON.stringify(v3);
    const w = migrateWorld(v3);
    expect(w.meta).toEqual({ v: WORLD_VERSION, dataHash: '0123456789abcdef' });
    // Iron's cap of 3 nodes has no rate to become, so it is dropped.
    expect(w.factories.map((f) => f.resources)).toEqual([{}, {}, {}]);
    expect(w.factories.every((f) => !('nodeBudget' in f))).toBe(true);
    // Everything else is carried over unchanged, and the input is untouched.
    expect(w.factories.map(({ resources: _, ...f }) => f)).toEqual(
      v3.factories.map(({ nodeBudget: _, ...f }) => ({ ...f, tweaks: [] })),
    );
    expect(w.defaults).toEqual({
      ...v3.defaults,
      objectives: ['scarcity'],
      avoidFluidByproducts: true,
    });
    expect(JSON.stringify(v3)).toBe(before);
  });

  test('a v3 budget turns off each resource whose node caps are all 0', () => {
    const doc = JSON.parse(JSON.stringify(v3)) as typeof v3;
    (doc.factories[0] as { nodeBudget: unknown }).nodeBudget = {
      'node:coal:normal': 0,
      'node:coal:pure': 0,
      'node:iron-ore:normal': 3,
      'node:iron-ore:pure': 0,
    };
    const w = migrateWorld(doc);
    expect(w.factories[0]!.resources).toEqual({ coal: { enabled: false } });
    expect(factorySolveRequest(w, { nodes: [] }, 'factory-1').resourceLimits).toEqual({ coal: 0 });
  });

  test('a v4 world on the old default stack moves to scarcity; other stacks stay', () => {
    const v4 = (objectives: string[]) => {
      const w = createWorld('x') as unknown as {
        meta: { v: number };
        defaults: { objectives: string[] };
        factories: { request: { objectives?: string[] } }[];
      };
      w.meta.v = 4;
      w.defaults.objectives = objectives;
      w.factories[0]!.request.objectives = ['resources'];
      return w;
    };
    const moved = migrateWorld(v4(['resources']));
    expect(moved.meta.v).toBe(WORLD_VERSION);
    expect(moved.defaults.objectives).toEqual(['scarcity']);
    // A factory's own choice is kept.
    expect(moved.factories[0]!.request.objectives).toEqual(['resources']);
    expect(migrateWorld(v4(['resources', 'machines'])).defaults.objectives).toEqual([
      'resources',
      'machines',
    ]);
    expect(migrateWorld(v4(['power'])).defaults.objectives).toEqual(['power']);
  });

  test('the v4 fixture (already on scarcity) migrates as the v5 fixture does', () => {
    expect(migrateWorld(v4)).toEqual(migrateWorld(v5));
  });

  test('a v5 save gains an empty tweak list per factory and nothing else (A35)', () => {
    const before = JSON.stringify(v5);
    const w = migrateWorld(v5);
    expect(w.meta).toEqual({ v: WORLD_VERSION, dataHash: v5.meta.dataHash });
    expect(w.factories).toEqual(v5.factories.map((f) => ({ ...f, tweaks: [] })));
    for (const key of ['groups', 'links', 'nodePool'] as const) expect(w[key]).toEqual(v5[key]);
    expect(w.defaults).toEqual({ ...v5.defaults, avoidFluidByproducts: true });
    expect(JSON.stringify(v5)).toBe(before);
    // The v6 fixture is the v5 one plus tweaks on one factory.
    expect({ ...w, factories: w.factories.map((f) => ({ ...f, tweaks: [] })) }).toEqual({
      ...v6,
      meta: { ...v6.meta, v: WORLD_VERSION },
      defaults: { ...v6.defaults, avoidFluidByproducts: true },
      factories: v6.factories.map((f) => ({ ...f, tweaks: [] })),
    });
  });

  test('a v6 save carries over unchanged but for its version (A36)', () => {
    const before = JSON.stringify(v6);
    const w = migrateWorld(v6);
    expect(w).toEqual({
      ...v6,
      meta: { ...v6.meta, v: WORLD_VERSION },
      defaults: { ...v6.defaults, avoidFluidByproducts: true },
    });
    expect(JSON.stringify(v6)).toBe(before);
    // The v7 fixture is the v6 one plus manual plans on two factories.
    const strip = (x: typeof w) => ({
      ...x,
      factories: x.factories.map(({ manual: _, ...f }) => f),
    });
    expect(strip(migrateWorld(v7))).toEqual(w);
  });

  test('a v7 save gains "Avoid fluid byproducts", on, in the world defaults (A39)', () => {
    const before = JSON.stringify(v7);
    const w = migrateWorld(v7);
    expect(w).toEqual({
      ...v7,
      meta: { ...v7.meta, v: WORLD_VERSION },
      defaults: { ...v7.defaults, avoidFluidByproducts: true },
    });
    expect(JSON.stringify(v7)).toBe(before);
    expect(factorySolveRequest(w, { nodes: [] }, 'factory-1').avoidFluidByproducts).toBe(true);
    // The v8 fixture is the migrated v7 one with the setting off in one factory.
    expect({
      ...v8,
      meta: { ...v8.meta, v: WORLD_VERSION },
      factories: v8.factories.map((f) => ({
        ...f,
        request: (({
          avoidFluidByproducts: _,
          ...r
        }: typeof f.request & { avoidFluidByproducts?: boolean }) => r)(f.request),
      })),
    }).toEqual(w);
    expect(
      factorySolveRequest(v8 as unknown as typeof w, { nodes: [] }, 'factory-2'),
    ).not.toHaveProperty('avoidFluidByproducts');
  });

  test('a v8 save carries over unchanged but for its version (A44)', () => {
    const before = JSON.stringify(v8);
    const w = migrateWorld(v8);
    expect(w).toEqual({ ...v8, meta: { ...v8.meta, v: WORLD_VERSION } });
    expect(JSON.stringify(v8)).toBe(before);
    expect(w.factories.some((f) => f.built)).toBe(false);
    // The v9 fixture is the v8 one plus a build mark on one factory.
    const strip = (x: typeof w) => ({
      ...x,
      factories: x.factories.map(({ built: _, ...f }) => f),
    });
    expect(strip(migrateWorld(v9))).toEqual(w);
  });

  test('a v9 save carries over unchanged but for its version, with no parents (A49)', () => {
    const before = JSON.stringify(v9);
    const w = migrateWorld(v9);
    expect(w).toEqual({ ...v9, meta: { ...v9.meta, v: WORLD_VERSION } });
    expect(JSON.stringify(v9)).toBe(before);
    expect(w.factories.some((f) => f.parentId !== undefined)).toBe(false);
    expect(w.links.some((l) => l.nested)).toBe(false);
    // The v10 fixture is the v9 one plus a sub-factory, its link and a collapsed parent.
    expect(v10.factories.filter((f) => 'parentId' in f)).toHaveLength(1);
  });

  test('a v10 save carries over unchanged but for its version, with default areas (A64)', () => {
    const before = JSON.stringify(v10);
    const w = migrateWorld(v10);
    expect(w).toEqual({ ...v10, meta: { ...v10.meta, v: WORLD_VERSION } });
    expect(JSON.stringify(v10)).toBe(before);
    expect(w.factories.some((f) => f.areas)).toBe(false);
    // The v11 fixture is the v10 one plus area settings on two factories.
    const strip = (x: typeof w) => ({
      ...x,
      factories: x.factories.map(({ areas: _, ...f }) => f),
    });
    expect(strip(migrateWorld(v11 as unknown as typeof w))).toEqual(w);
  });

  test('a v11 save carries over unchanged, keeping fluid modules made here (A69)', () => {
    const before = JSON.stringify(v11);
    const w = migrateWorld(v11);
    expect(w).toEqual({ ...v11, meta: { ...v11.meta, v: WORLD_VERSION } });
    expect(JSON.stringify(v11)).toBe(before);
    const req = factorySolveRequest(w, { nodes: [] }, w.factories[0]!.id);
    expect(req).not.toHaveProperty('minerFluids');
    expect(req).not.toHaveProperty('minerFluidSupply');
    // A new world supplies miner fluid from outside.
    const fresh = createWorld('x');
    expect(fresh.defaults).toMatchObject({ minerFluids: 'any', minerFluidSupply: 'outside' });
    expect(factorySolveRequest(fresh, { nodes: [] }, fresh.factories[0]!.id)).toMatchObject({
      minerFluidSupply: 'outside',
    });
    // The v12 fixture is the migrated v11 one with the settings set in the world and one factory.
    const unset = JSON.parse(JSON.stringify(v12)) as typeof v12;
    const defaults: { minerFluids?: string; minerFluidSupply?: string } = unset.defaults;
    delete defaults.minerFluids;
    delete defaults.minerFluidSupply;
    delete (unset.factories[0]!.request as { minerFluidSupply?: string }).minerFluidSupply;
    expect(unset).toEqual(w);
    expect(factorySolveRequest(v12 as typeof w, { nodes: [] }, 'factory-1')).toMatchObject({
      minerFluids: 'water',
    });
    expect(factorySolveRequest(v12 as typeof w, { nodes: [] }, 'factory-1')).not.toHaveProperty(
      'minerFluidSupply',
    );
  });

  test('a current world passes through unchanged', () => {
    const w = createWorld('x');
    expect(migrateWorld(w)).toEqual(w);
  });

  test('rejects newer, missing and malformed versions', () => {
    const w = createWorld('x');
    expect(() => migrateWorld({ ...w, meta: { v: WORLD_VERSION + 1, dataHash: '' } })).toThrow(
      WorldMigrationError,
    );
    expect(() => migrateWorld({ ...w, meta: {} })).toThrow(/invalid world version/);
    expect(() => migrateWorld(null)).toThrow(/Not a world document/);
  });
});
