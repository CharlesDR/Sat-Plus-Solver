/**
 * Where the app's first world comes from, and keeping the autosave current.
 * A share link wins over the autosave; the autosave it replaces is kept as
 * the backup, so opening someone's link never loses your own world.
 */
import { createWorld, parseWorld, serializeWorld, type World } from '@sps/world';
import type { WorldStore } from '../store';
import type { Saves } from './saves';
import { isShareHash, readShareHash } from './share';

export interface Boot {
  world: World;
  source: 'link' | 'autosave' | 'new';
  /** Something could not be read, said for the user. */
  problem?: string;
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The world to start with: the share link in `hash`, else the autosave, else a new one. */
export function bootWorld(hash: string, saves: Saves): Boot {
  let problem: string | undefined;
  if (isShareHash(hash)) {
    try {
      const world = readShareHash(hash);
      saves.backupAutosave();
      return { world, source: 'link' };
    } catch (e) {
      problem = `The share link could not be opened: ${why(e)}`;
    }
  }
  const text = saves.readAutosave();
  if (text !== undefined) {
    try {
      return { world: parseWorld(text), source: 'autosave', ...(problem ? { problem } : {}) };
    } catch (e) {
      // Keep the unreadable autosave as the backup before a new world replaces it.
      saves.backupAutosave();
      problem = `Your autosave could not be read (${why(e)}); it is kept as the backup.`;
    }
  }
  return { world: createWorld(), source: 'new', ...(problem ? { problem } : {}) };
}

/** Writes the world to the autosave now and whenever it changes. Returns the unsubscribe. */
export function startAutosave(store: WorldStore, saves: Saves): () => void {
  if (!saves.available) return () => {};
  saves.writeAutosave(serializeWorld(store.getState().world));
  return store.subscribe((s, prev) => {
    if (s.world !== prev.world) saves.writeAutosave(serializeWorld(s.world));
  });
}
