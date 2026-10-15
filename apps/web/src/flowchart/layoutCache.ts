/**
 * Flowchart layout cache (S3): finished layouts by a hash of the graph, the
 * layout options and the layout code, in memory and in IndexedDB, so a plan
 * seen before opens without running ELK again. A key always gives the layout
 * computed for it, so layout stays deterministic. The build stamps a hash of
 * packages/graph's code (`__LAYOUT_CODE__`, vite.config.ts), so a layout-code
 * change starts a fresh cache. Every storage access is wrapped: without
 * IndexedDB the cache lives in memory for the visit.
 */
import type { FactoryGraph, FactoryLayout } from '@sps/graph';

declare const __LAYOUT_CODE__: string | undefined;

/** The layout code's version: the build's hash of packages/graph, or `dev`. */
export const LAYOUT_CODE = typeof __LAYOUT_CODE__ === 'string' ? __LAYOUT_CODE__ : 'dev';
/** Layouts kept in memory and in IndexedDB. */
export const MEMORY_LAYOUTS = 30;
export const SAVED_LAYOUTS = 200;

const DB = 'sps-layout';
const STORE = 'layouts';

/** cyrb53: a fast, well-spread 53-bit string hash, as hex. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * The cache key of a layout: the graph, the options that size its text
 * (`format`, a fingerprint of the number format) and the layout code.
 */
export function layoutKey(graph: FactoryGraph, format: string): string {
  return `${LAYOUT_CODE}:${hashText(format + '\n' + JSON.stringify(graph))}`;
}

const memory = new Map<string, FactoryLayout>();

function remember(key: string, layout: FactoryLayout): void {
  memory.delete(key);
  memory.set(key, layout);
  while (memory.size > MEMORY_LAYOUTS) memory.delete(memory.keys().next().value!);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed to open.'));
  });
}

async function load(key: string): Promise<FactoryLayout | undefined> {
  try {
    const db = await open();
    try {
      return await new Promise<FactoryLayout | undefined>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as FactoryLayout | undefined);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed.'));
      });
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

/** Saves a layout; drops other layout-code versions and the oldest beyond the limit. */
async function save(key: string, layout: FactoryLayout): Promise<void> {
  try {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.put(layout, key);
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          const all = (keys.result as string[]).filter((k) => k !== key);
          const stale = all.filter((k) => !k.startsWith(`${LAYOUT_CODE}:`));
          const current = all.filter((k) => k.startsWith(`${LAYOUT_CODE}:`));
          for (const k of [
            ...stale,
            ...current.slice(0, Math.max(0, current.length - SAVED_LAYOUTS + 1)),
          ])
            store.delete(k);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed.'));
      });
    } finally {
      db.close();
    }
  } catch {
    // No storage: the layout is kept in memory only.
  }
}

/** The layout for `key`: from memory, else IndexedDB, else `compute` (then kept). */
export async function cachedLayout(
  key: string,
  compute: () => Promise<FactoryLayout>,
): Promise<FactoryLayout> {
  const hit = memory.get(key);
  if (hit) {
    remember(key, hit);
    return hit;
  }
  const saved = await load(key);
  if (saved) {
    remember(key, saved);
    return saved;
  }
  const layout = await compute();
  remember(key, layout);
  void save(key, layout);
  return layout;
}
