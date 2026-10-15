/**
 * Solver caches kept across reloads (A90): the worker's memo of factory
 * solves and the solver's embodied import costs, in IndexedDB, for one model
 * data hash at a time. Every access is wrapped: without storage (a private
 * window, blocked site data) the app works and simply starts cold.
 */
import type { CostCacheEntry } from '@sps/solver';
import type { SolveCache } from '@sps/world';

export interface SavedCaches {
  dataHash: string;
  solves: [string, SolveCache extends Map<string, infer V> ? V : never][];
  costs: CostCacheEntry[];
}

/** Most entries kept of each cache, the newest. */
export const SAVED_SOLVES = 100;
export const SAVED_COSTS = 2000;

const DB = 'sps-solver';
const STORE = 'caches';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed to open.'));
  });
}

/** The saved caches for `dataHash`, or undefined (none, other data, or no storage). */
export async function loadCaches(dataHash: string): Promise<SavedCaches | undefined> {
  try {
    const db = await open();
    try {
      const saved = await new Promise<unknown>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed.'));
      });
      const s = saved as SavedCaches | undefined;
      return s && s.dataHash === dataHash && Array.isArray(s.solves) && Array.isArray(s.costs)
        ? s
        : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/** Saves the caches, keeping the newest entries; quietly does nothing without storage. */
export async function saveCaches(caches: SavedCaches): Promise<void> {
  try {
    const db = await open();
    try {
      const value: SavedCaches = {
        dataHash: caches.dataHash,
        solves: caches.solves.slice(-SAVED_SOLVES),
        costs: caches.costs.slice(-SAVED_COSTS),
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed.'));
      });
    } finally {
      db.close();
    }
  } catch {
    // No storage: the caches live for this visit only.
  }
}
