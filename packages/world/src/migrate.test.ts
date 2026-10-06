import { describe, expect, test } from 'vitest';
import v1 from '../../../fixtures/worlds/v1-world.json';
import v2 from '../../../fixtures/worlds/v2-world.json';
import v3 from '../../../fixtures/worlds/v3-world.json';
import { WORLD_VERSION, createWorld, factorySolveRequest } from './document';
import { WorldMigrationError, migrateWorld } from './migrate';

describe('migrateWorld', () => {
  test('a v1 (M3) save migrates to the current version with both toggles off', () => {
    const before = JSON.stringify(v1);
    const w = migrateWorld(v1);
    expect(w.meta).toEqual({ v: WORLD_VERSION, dataHash: 'abc123' });
    expect(w.defaults).toEqual({
      objectives: ['resources'],
      tolerance: 0.0001,
      alternates: false,
      wholeMachines: false,
      costImports: false,
      recipes: { 'cast-screw': false },
      maxTier: null,
    });
    // The whole-pool budget becomes no resource limits (v4, A33); everything
    // else is carried over unchanged, and the input is untouched.
    expect(w.factories).toEqual(
      v1.factories.map(({ nodeBudget: _, ...f }) => ({ ...f, resources: {} })),
    );
    expect(w.nodePool).toEqual(v1.nodePool);
    expect(JSON.stringify(v1)).toBe(before);
  });

  test('a v2 (M5) save migrates exclusions to recipe toggles with the same effect', () => {
    const before = JSON.stringify(v2);
    const w = migrateWorld(v2);
    expect(w.meta.v).toBe(WORLD_VERSION);
    expect(w.defaults).toEqual({
      objectives: ['resources'],
      tolerance: 0.0001,
      alternates: false,
      wholeMachines: true,
      costImports: false,
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
      v2.factories.map(({ request: _, nodeBudget: __, ...f }) => f),
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
      v3.factories.map(({ nodeBudget: _, ...f }) => f),
    );
    expect(w.defaults).toEqual(v3.defaults);
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
