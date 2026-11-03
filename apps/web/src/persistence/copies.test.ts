import { createWorld, type World } from '@sps/world';
import { describe, expect, test } from 'vitest';
import { compareCopies, keepBothName, savedTime } from './copies';

/** A copy of world `id`, saved at `savedAt`. */
function copy(id: string | undefined, savedAt?: string): World {
  const w = createWorld('h');
  if (id !== undefined) w.meta.worldId = id;
  if (savedAt !== undefined) w.meta.savedAt = savedAt;
  return w;
}

const NINE = '2026-11-03T09:00:00.000Z';
const TEN = '2026-11-03T10:00:00.000Z';

describe('copies of one world (A109)', () => {
  test('a newer copy', () => {
    expect(compareCopies(copy('w', NINE), copy('w', TEN))).toEqual({
      age: 'newer',
      incoming: TEN,
      open: NINE,
    });
  });

  test('an older copy', () => {
    expect(compareCopies(copy('w', TEN), copy('w', NINE))).toEqual({
      age: 'older',
      incoming: NINE,
      open: TEN,
    });
  });

  test('a copy saved at the same time', () => {
    expect(compareCopies(copy('w', TEN), copy('w', TEN))).toEqual({
      age: 'same',
      incoming: TEN,
      open: TEN,
    });
  });

  test('a copy never edited is older than one that was', () => {
    expect(compareCopies(copy('w', TEN), copy('w'))).toEqual({ age: 'older', open: TEN });
    expect(compareCopies(copy('w'), copy('w', TEN))).toEqual({ age: 'newer', incoming: TEN });
    expect(compareCopies(copy('w'), copy('w'))).toEqual({ age: 'same' });
  });

  test('different worlds, or worlds without an id, are not copies', () => {
    expect(compareCopies(copy('a', NINE), copy('b', TEN))).toBeUndefined();
    expect(compareCopies(copy(undefined), copy(undefined))).toBeUndefined();
    expect(compareCopies(copy(undefined), copy('a'))).toBeUndefined();
    expect(compareCopies(copy('a'), copy(undefined))).toBeUndefined();
  });

  test('saved times and the Keep both slot name', () => {
    expect(savedTime(undefined)).toBe('not recorded');
    expect(savedTime('nonsense')).toBe('not recorded');
    expect(savedTime(TEN)).toBe(new Date(TEN).toLocaleString());
    const named = copy('w', TEN);
    named.meta.name = 'Phase 2';
    expect(keepBothName(named, (iso) => `at ${iso}`)).toBe(`Phase 2 (saved at ${TEN})`);
    expect(keepBothName(copy('w'))).toBe('Unnamed world (kept)');
  });
});
