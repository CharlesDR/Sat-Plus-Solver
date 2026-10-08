import { createWorld, freshWorld, parseWorld, serializeWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import sample from '../../../../examples/world.json';
import { createWorldStore } from '../store';
import { restorePrevious, startNewWorld } from './newWorld';
import { createSaves } from './saves';
import { startAutosave } from './session';
import { blockedStorage, memoryStorage } from './testing';

/** A store autosaving into fresh storage, holding a world with a target and a setting. */
const setup = (storage: Storage = memoryStorage()) => {
  const world = createWorld('h');
  world.defaults.alternates = true;
  world.meta.name = 'Phase 1';
  world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
  const store = createWorldStore(world);
  const saves = createSaves(storage);
  startAutosave(store, saves);
  return { store, saves, world };
};

describe('New world (N1–N3)', () => {
  test('keeps the settings, saves first when asked, and undoes back to the old world', () => {
    const { store, saves, world } = setup();
    const out = startNewWorld(store, saves, { from: 'settings', name: 'Phase 2', saveAs: 'P1' });
    expect(out).toEqual({ ok: true, undoable: true });
    expect(store.getState().world).toEqual(freshWorld(world, true, 'Phase 2'));
    expect(parseWorld(saves.load(saves.list()[0]!.id)!)).toEqual(world);
    expect(restorePrevious(store, saves)).toBeUndefined();
    expect(store.getState().world).toEqual(world);
  });

  test('empty and sample starts', () => {
    const { store, saves } = setup();
    startNewWorld(store, saves, { from: 'empty', name: '' });
    expect(store.getState().world).toEqual(createWorld('h'));
    startNewWorld(store, saves, { from: 'sample', name: 'Demo' });
    const w = store.getState().world;
    expect(w.meta.name).toBe('Demo');
    expect(w.factories.map((f) => f.name)).toEqual(sample.factories.map((f) => f.name));
  });

  test('a failed save stops before anything changes', () => {
    const { store, saves, world } = setup();
    expect(startNewWorld(store, saves, { from: 'empty', name: '', saveAs: ' ' })).toEqual({
      ok: false,
      message: 'Give the save a name.',
    });
    expect(store.getState().world).toBe(world);
  });

  test('without storage it still starts, but cannot be undone', () => {
    const { store, saves } = setup(blockedStorage());
    expect(startNewWorld(store, saves, { from: 'empty', name: '' })).toEqual({
      ok: true,
      undoable: false,
    });
    expect(restorePrevious(store, saves)).toBe('There is no previous world to restore.');
    expect(serializeWorld(store.getState().world)).toBe(serializeWorld(createWorld('h')));
  });
});
