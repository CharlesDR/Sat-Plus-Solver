/**
 * Starting over (N1–N3): a new world from the current one's settings, an
 * empty one or the sample, after an optional save to a slot. The world it
 * replaces becomes the backup, so "Restore previous world" (or the toast's
 * Undo) brings it back.
 */
import { freshWorld, parseWorld, renameWorld, serializeWorld, type World } from '@sps/world';
import sample from '../../../../examples/world.json';
import type { WorldStore } from '../store';
import type { Saves } from './saves';

export type StartFrom = 'settings' | 'empty' | 'sample';

export interface NewWorldOptions {
  from: StartFrom;
  /** The new world's name; blank leaves it unnamed (the sample keeps its own). */
  name: string;
  /** Saves the current world to this slot first. */
  saveAs?: string | undefined;
}

export type NewWorldOutcome = { ok: true; undoable: boolean } | { ok: false; message: string };

/** The world to start from, built from the current one. */
export function startingWorld(current: World, from: StartFrom, name: string): World {
  if (from !== 'sample') return freshWorld(current, from === 'settings', name);
  const world = parseWorld(JSON.stringify(sample));
  return name.trim() ? renameWorld(world, name) : world;
}

/** Replaces the world with a new one; the old one becomes the backup. */
export function startNewWorld(
  store: WorldStore,
  saves: Saves,
  options: NewWorldOptions,
): NewWorldOutcome {
  const current = store.getState().world;
  if (options.saveAs !== undefined) {
    const out = saves.save(options.saveAs, serializeWorld(current));
    if (!out.ok) return out;
  }
  const next = startingWorld(current, options.from, options.name);
  saves.backupAutosave();
  store.getState().loadWorld(next);
  return { ok: true, undoable: saves.readBackup() !== undefined };
}

/** Brings back the backup; returns why it could not, if it could not. */
export function restorePrevious(store: WorldStore, saves: Saves): string | undefined {
  const text = saves.readBackup();
  if (text === undefined) return 'There is no previous world to restore.';
  let world: World;
  try {
    world = parseWorld(text);
  } catch (e) {
    return `The previous world could not be read: ${e instanceof Error ? e.message : String(e)}`;
  }
  saves.backupAutosave();
  store.getState().loadWorld(world);
  return undefined;
}
