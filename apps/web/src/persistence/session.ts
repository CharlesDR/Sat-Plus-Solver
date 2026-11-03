/**
 * Where the app's first world comes from, and keeping the autosave current.
 * A share link wins over the autosave; the autosave it replaces is kept as
 * the backup, so opening someone's link never loses your own world. A link
 * to a copy of the autosaved world (A109) starts from the autosave, and the
 * app asks which copy to keep.
 */
import { emptyWorld, parseWorld, serializeWorld, type World } from '@sps/world';
import type { WorldStore } from '../store';
import { compareCopies } from './copies';
import type { Saves } from './saves';
import { isShareHash, readShareHash } from './share';

export interface Boot {
  world: World;
  source: 'link' | 'autosave' | 'new';
  /** Something could not be read, said for the user. */
  problem?: string;
  /** The shared world, when it is a copy of the autosaved one (A109): not opened yet. */
  incoming?: World;
}

/** True when the boot read the share link in the address bar, so it can be dropped from there. */
export function readLink(boot: Boot): boolean {
  return boot.source === 'link' || boot.incoming !== undefined;
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The world to start with: the share link in `hash`, else the autosave, else
 * a new one with no factory yet (UX-8).
 */
export async function bootWorld(hash: string, saves: Saves): Promise<Boot> {
  let problem: string | undefined;
  if (isShareHash(hash)) {
    try {
      const world = await readShareHash(hash);
      const mine = readAutosave(saves);
      if (mine && compareCopies(mine, world))
        return { world: mine, source: 'autosave', incoming: world };
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
  return { world: emptyWorld(), source: 'new', ...(problem ? { problem } : {}) };
}

/** The autosaved world, if there is one and it can be read. */
function readAutosave(saves: Saves): World | undefined {
  const text = saves.readAutosave();
  try {
    return text === undefined ? undefined : parseWorld(text);
  } catch {
    return undefined;
  }
}

/** Writes the world to the autosave now and whenever it changes. Returns the unsubscribe. */
export function startAutosave(store: WorldStore, saves: Saves): () => void {
  if (!saves.available) return () => {};
  saves.writeAutosave(serializeWorld(store.getState().world));
  return store.subscribe((s, prev) => {
    if (s.world !== prev.world) saves.writeAutosave(serializeWorld(s.world));
  });
}
