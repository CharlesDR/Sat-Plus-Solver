import { describe, expect, test } from 'vitest';
import v1 from '../../../fixtures/worlds/v1-world.json';
import { WORLD_VERSION, createWorld } from './document';
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
      excludeRecipes: ['cast-screw'],
    });
    // Everything else is carried over unchanged, and the input is untouched.
    expect(w.factories).toEqual(v1.factories);
    expect(w.nodePool).toEqual(v1.nodePool);
    expect(JSON.stringify(v1)).toBe(before);
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
