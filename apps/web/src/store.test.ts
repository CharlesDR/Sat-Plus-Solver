import { DEFAULT_FACTORY_ID, WORLD_VERSION, createWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import { createWorldStore } from './store';

describe('world store', () => {
  test('starts as a one-factory World document', () => {
    const { world } = createWorldStore().getState();
    expect(world).toEqual(createWorld());
    expect(world.meta.v).toBe(WORLD_VERSION);
    expect(world.factories).toHaveLength(1);
  });

  test('setTarget replaces the target immutably and can clear it', () => {
    const store = createWorldStore();
    const before = store.getState().world;
    store.getState().setTarget(DEFAULT_FACTORY_ID, { item: 'iron-plate', rate: 60 });
    const after = store.getState().world;
    expect(after).not.toBe(before);
    expect(before.factories[0]!.request.targets).toEqual([]);
    expect(after.factories[0]!.request.targets).toEqual([{ item: 'iron-plate', rate: 60 }]);
    expect(after.defaults).toBe(before.defaults);

    store.getState().setTarget(DEFAULT_FACTORY_ID, { item: 'screw', rate: 10 });
    expect(store.getState().world.factories[0]!.request.targets).toEqual([
      { item: 'screw', rate: 10 },
    ]);
    store.getState().setTarget(DEFAULT_FACTORY_ID, null);
    expect(store.getState().world.factories[0]!.request.targets).toEqual([]);
  });

  test('setTarget on an unknown factory throws', () => {
    expect(() => createWorldStore().getState().setTarget('nope', null)).toThrow(/Unknown factory/);
  });

  test('attachData fills an empty hash, keeps a matching one, and flags a mismatch', () => {
    const store = createWorldStore();
    store.getState().attachData('h1');
    expect(store.getState().world.meta.dataHash).toBe('h1');
    const world = store.getState().world;
    store.getState().attachData('h1');
    expect(store.getState().world).toBe(world);
    expect(store.getState().dataHashMismatch).toBeUndefined();

    store.getState().attachData('h2');
    expect(store.getState().world.meta.dataHash).toBe('h1');
    expect(store.getState().dataHashMismatch).toEqual({ world: 'h1', model: 'h2' });
  });
});
