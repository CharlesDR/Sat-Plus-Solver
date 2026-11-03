import { createWorld, emptyWorld, parseWorld, serializeWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import v2 from '../../../../fixtures/worlds/v2-world.json';
import { createWorldStore } from '../store';
import { createSaves } from './saves';
import { bootWorld, readLink, startAutosave } from './session';
import { shareLink } from './share';
import { memoryStorage } from './testing';

const hashOf = async (world: unknown) => {
  const link = await shareLink(world as never, 'https://example.test/');
  if (!link.ok) throw new Error('expected a link');
  return new URL(link.url).hash;
};

describe('bootWorld', () => {
  test('a new world with no factory when nothing is saved', async () => {
    const boot = await bootWorld('', createSaves(memoryStorage()));
    expect(boot).toEqual({ world: emptyWorld(), source: 'new' });
  });

  test('the autosave, migrated', async () => {
    const saves = createSaves(memoryStorage());
    saves.writeAutosave(JSON.stringify(v2));
    const boot = await bootWorld('', saves);
    expect(boot.source).toBe('autosave');
    expect(boot.world).toStrictEqual(parseWorld(JSON.stringify(v2)));
  });

  test('a share link wins and keeps the autosave as the backup', async () => {
    const saves = createSaves(memoryStorage());
    const mine = createWorld('mine');
    saves.writeAutosave(serializeWorld(mine));
    const theirs = createWorld('theirs');
    theirs.factories[0]!.name = 'Shared';
    const boot = await bootWorld(await hashOf(theirs), saves);
    expect(boot).toEqual({ world: theirs, source: 'link' });
    expect(saves.readBackup()).toBe(serializeWorld(mine));
  });

  test('a link to a copy of the autosaved world starts from the autosave and holds the link (A109)', async () => {
    const saves = createSaves(memoryStorage());
    const mine = createWorld('h');
    mine.meta.worldId = 'w1';
    mine.meta.savedAt = '2026-11-03T09:00:00.000Z';
    saves.writeAutosave(serializeWorld(mine));
    const theirs = createWorld('h');
    theirs.meta = { ...mine.meta, savedAt: '2026-11-03T10:00:00.000Z' };
    theirs.factories[0]!.name = 'Later';
    const boot = await bootWorld(await hashOf(theirs), saves);
    expect(boot).toEqual({ world: mine, source: 'autosave', incoming: theirs });
    expect(readLink(boot)).toBe(true);
    // Nothing is replaced until the user picks, so the backup is not touched.
    expect(saves.readBackup()).toBeUndefined();
    // Another world's link opens as before.
    const other = { ...theirs, meta: { ...theirs.meta, worldId: 'w2' } };
    expect(await bootWorld(await hashOf(other), saves)).toEqual({ world: other, source: 'link' });
    expect(readLink(await bootWorld('', saves))).toBe(false);
  });

  test('a bad link or autosave is reported, and the bad autosave is kept', async () => {
    const saves = createSaves(memoryStorage());
    saves.writeAutosave('{"broken"');
    const boot = await bootWorld('#z=garbage', saves);
    expect(boot.source).toBe('new');
    expect(boot.problem).toMatch(/autosave could not be read/);
    expect(saves.readBackup()).toBe('{"broken"');

    const ok = createSaves(memoryStorage());
    ok.writeAutosave(serializeWorld(createWorld('x')));
    const b2 = await bootWorld('#w=garbage', ok);
    expect(b2.source).toBe('autosave');
    expect(b2.problem).toMatch(/share link could not be opened/);
  });
});

describe('startAutosave', () => {
  test('writes the world now and after every edit', () => {
    const saves = createSaves(memoryStorage());
    const store = createWorldStore();
    const stop = startAutosave(store, saves);
    expect(saves.readAutosave()).toBe(serializeWorld(createWorld()));
    const id = store.getState().addFactory('Smelter');
    expect(parseWorld(saves.readAutosave()!).factories.map((f) => f.id)).toContain(id);
    stop();
    store.getState().renameFactory(id, 'Later');
    expect(parseWorld(saves.readAutosave()!).factories.find((f) => f.id === id)!.name).toBe(
      'Smelter',
    );
  });

  test('does nothing without storage', () => {
    const store = createWorldStore();
    expect(() => startAutosave(store, createSaves(undefined))()).not.toThrow();
  });
});
