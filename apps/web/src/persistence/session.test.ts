import { createWorld, parseWorld, serializeWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import v2 from '../../../../fixtures/worlds/v2-world.json';
import { createWorldStore } from '../store';
import { createSaves } from './saves';
import { bootWorld, startAutosave } from './session';
import { shareLink } from './share';
import { memoryStorage } from './testing';

const hashOf = (world: unknown) => {
  const link = shareLink(world as never, 'https://example.test/');
  if (!link.ok) throw new Error('expected a link');
  return new URL(link.url).hash;
};

describe('bootWorld', () => {
  test('a new world when nothing is saved', () => {
    const boot = bootWorld('', createSaves(memoryStorage()));
    expect(boot).toEqual({ world: createWorld(), source: 'new' });
  });

  test('the autosave, migrated', () => {
    const saves = createSaves(memoryStorage());
    saves.writeAutosave(JSON.stringify(v2));
    const boot = bootWorld('', saves);
    expect(boot.source).toBe('autosave');
    expect(boot.world).toStrictEqual(parseWorld(JSON.stringify(v2)));
  });

  test('a share link wins and keeps the autosave as the backup', () => {
    const saves = createSaves(memoryStorage());
    const mine = createWorld('mine');
    saves.writeAutosave(serializeWorld(mine));
    const theirs = createWorld('theirs');
    theirs.factories[0]!.name = 'Shared';
    const boot = bootWorld(hashOf(theirs), saves);
    expect(boot).toEqual({ world: theirs, source: 'link' });
    expect(saves.readBackup()).toBe(serializeWorld(mine));
  });

  test('a bad link or autosave is reported, and the bad autosave is kept', () => {
    const saves = createSaves(memoryStorage());
    saves.writeAutosave('{"broken"');
    const boot = bootWorld('#w=garbage', saves);
    expect(boot.source).toBe('new');
    expect(boot.problem).toMatch(/autosave could not be read/);
    expect(saves.readBackup()).toBe('{"broken"');

    const ok = createSaves(memoryStorage());
    ok.writeAutosave(serializeWorld(createWorld('x')));
    const b2 = bootWorld('#w=garbage', ok);
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
