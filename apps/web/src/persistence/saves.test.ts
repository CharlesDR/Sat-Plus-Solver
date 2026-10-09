import { describe, expect, test } from 'vitest';
import { MAX_SLOTS, SIMPLE_PREFIX, createSaves } from './saves';
import { blockedStorage, memoryStorage } from './testing';

const clock = () => {
  let t = 1000;
  return () => (t += 1000);
};

describe('local saves (PLAN M9)', () => {
  test('autosave, backup, and named slots', () => {
    const storage = memoryStorage();
    const saves = createSaves(storage, clock());
    expect(saves.available).toBe(true);
    expect(saves.readAutosave()).toBeUndefined();
    expect(saves.writeAutosave('a1')).toBe(true);
    saves.backupAutosave();
    saves.writeAutosave('a2');
    expect(saves.readAutosave()).toBe('a2');
    expect(saves.readBackup()).toBe('a1');

    const one = saves.save('  Base  ', 'w1');
    expect(one).toEqual({ ok: true, slot: { id: 'slot-1', name: 'Base', savedAt: 2000 } });
    saves.save('Outpost', 'w2');
    // The same name overwrites its slot.
    expect(saves.save('Base', 'w3')).toMatchObject({ ok: true, slot: { id: 'slot-1' } });
    expect(saves.list().map((s) => s.name)).toEqual(['Base', 'Outpost']);
    expect(saves.load('slot-1')).toBe('w3');
    saves.remove('slot-1');
    expect(saves.list().map((s) => s.id)).toEqual(['slot-2']);
    expect(saves.load('slot-1')).toBeUndefined();
    // A freed id is reused; another instance reads the same slots.
    expect(saves.save('Again', 'w4')).toMatchObject({ ok: true, slot: { id: 'slot-1' } });
    expect(
      createSaves(storage)
        .list()
        .map((s) => s.id),
    ).toEqual(['slot-1', 'slot-2']);
    expect(saves.save('   ', 'x')).toEqual({ ok: false, message: 'Give the save a name.' });
  });

  test(`at most ${MAX_SLOTS} slots`, () => {
    const saves = createSaves(memoryStorage(), clock());
    for (let k = 1; k <= MAX_SLOTS; k++) expect(saves.save(`s${k}`, 'w').ok).toBe(true);
    expect(saves.save('one more', 'w')).toMatchObject({ ok: false, message: /slots are in use/ });
    expect(saves.save('s3', 'w2').ok).toBe(true);
  });

  test('a full store refuses the save without losing what was there', () => {
    const storage = memoryStorage(200);
    const saves = createSaves(storage, clock());
    expect(saves.save('small', 'w').ok).toBe(true);
    expect(saves.save('big', 'x'.repeat(500))).toMatchObject({ ok: false, message: /refused/ });
    expect(saves.list().map((s) => s.name)).toEqual(['small']);
    expect(saves.writeAutosave('y'.repeat(500))).toBe(false);
  });

  test('works without storage, and when every access throws', () => {
    for (const storage of [undefined, blockedStorage()]) {
      const saves = createSaves(storage);
      expect(saves.available).toBe(false);
      expect(saves.writeAutosave('a')).toBe(false);
      expect(saves.readAutosave()).toBeUndefined();
      saves.backupAutosave();
      expect(saves.readBackup()).toBeUndefined();
      expect(saves.list()).toEqual([]);
      expect(saves.save('x', 'w')).toMatchObject({ ok: false });
      expect(saves.load('slot-1')).toBeUndefined();
      expect(() => saves.remove('slot-1')).not.toThrow();
    }
  });

  test('a corrupt slot index reads as empty', () => {
    const storage = memoryStorage();
    storage.setItem('sps:slots', '{not json');
    expect(createSaves(storage).list()).toEqual([]);
    storage.setItem('sps:slots', JSON.stringify([{ id: 'slot-1' }, 7]));
    expect(createSaves(storage).list()).toEqual([]);
  });

  test('simple mode keeps its own saves under its prefix (A72)', () => {
    const storage = memoryStorage();
    const main = createSaves(storage);
    const simple = createSaves(storage, clock(), SIMPLE_PREFIX);
    main.writeAutosave('m');
    simple.writeAutosave('s');
    simple.backupAutosave();
    simple.save('Mine', 'x');
    expect(main.readAutosave()).toBe('m');
    expect(main.readBackup()).toBeUndefined();
    expect(main.list()).toEqual([]);
    expect(simple.readAutosave()).toBe('s');
    expect(simple.list().map((s) => s.name)).toEqual(['Mine']);
    expect([...storage.data.keys()].filter((k) => !k.startsWith('sps:simple:'))).toEqual([
      'sps:autosave',
    ]);
  });
});
