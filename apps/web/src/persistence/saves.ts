/**
 * Local saves (PLAN M9): an autosave, a backup of it taken before a load
 * replaces it, and up to `MAX_SLOTS` named slots. Every storage access is
 * wrapped in try/catch (CLAUDE.md): without storage, or when it is full,
 * the app keeps working and only these saves are lost.
 */

export const MAX_SLOTS = 10;

const KEY = {
  autosave: 'sps:autosave',
  backup: 'sps:autosave:backup',
  slots: 'sps:slots',
  slot: (id: string) => `sps:slot:${id}`,
};

export interface SlotInfo {
  id: string;
  name: string;
  /** Epoch ms. */
  savedAt: number;
}

export type SaveOutcome = { ok: true; slot: SlotInfo } | { ok: false; message: string };

export interface Saves {
  /** False when the browser gives no usable storage. */
  readonly available: boolean;
  readAutosave(): string | undefined;
  /** Returns false when the write failed. */
  writeAutosave(text: string): boolean;
  /** Keeps the current autosave as the backup, when there is one. */
  backupAutosave(): void;
  readBackup(): string | undefined;
  /** Slots, newest first. */
  list(): SlotInfo[];
  /** Saves into the slot with this name, or a new one while there is room. */
  save(name: string, text: string): SaveOutcome;
  load(id: string): string | undefined;
  remove(id: string): void;
}

/** Storage in the browser, or `undefined` where even reaching it throws. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Saves over `storage`; `now` is injected so tests are deterministic. */
export function createSaves(storage: Storage | undefined, now: () => number = Date.now): Saves {
  const get = (key: string): string | undefined => {
    try {
      return storage?.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const put = (key: string, value: string): boolean => {
    if (!storage) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };
  const drop = (key: string) => {
    try {
      storage?.removeItem(key);
    } catch {
      // Nothing to do: the entry stays.
    }
  };
  const index = (): SlotInfo[] => {
    try {
      const v: unknown = JSON.parse(get(KEY.slots) ?? '[]');
      return Array.isArray(v) ? v.filter(isSlot) : [];
    } catch {
      return [];
    }
  };
  const available = (() => {
    const probe = 'sps:probe';
    if (!put(probe, '1')) return false;
    drop(probe);
    return true;
  })();

  return {
    available,
    readAutosave: () => get(KEY.autosave),
    writeAutosave: (text) => put(KEY.autosave, text),
    backupAutosave: () => {
      const current = get(KEY.autosave);
      if (current !== undefined) put(KEY.backup, current);
    },
    readBackup: () => get(KEY.backup),
    list: () => [...index()].sort((a, b) => b.savedAt - a.savedAt || (a.id < b.id ? -1 : 1)),
    save: (rawName, text) => {
      if (!available) return { ok: false, message: 'This browser does not allow local saves.' };
      const name = rawName.trim();
      if (!name) return { ok: false, message: 'Give the save a name.' };
      const slots = index();
      const existing = slots.find((s) => s.name === name);
      if (!existing && slots.length >= MAX_SLOTS)
        return {
          ok: false,
          message: `All ${MAX_SLOTS} slots are in use. Overwrite or delete one first.`,
        };
      const slot: SlotInfo = { id: existing?.id ?? freeId(slots), name, savedAt: now() };
      if (!put(KEY.slot(slot.id), text))
        return { ok: false, message: 'The browser refused the save (storage may be full).' };
      const next = [...slots.filter((s) => s.id !== slot.id), slot];
      if (!put(KEY.slots, JSON.stringify(next)))
        return { ok: false, message: 'The browser refused the save (storage may be full).' };
      return { ok: true, slot };
    },
    load: (id) => get(KEY.slot(id)),
    remove: (id) => {
      drop(KEY.slot(id));
      put(KEY.slots, JSON.stringify(index().filter((s) => s.id !== id)));
    },
  };
}

function isSlot(v: unknown): v is SlotInfo {
  const s = v as SlotInfo;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.savedAt === 'number'
  );
}

/** `slot-n` with the smallest free n. */
function freeId(slots: SlotInfo[]): string {
  const taken = new Set(slots.map((s) => s.id));
  let n = 1;
  while (taken.has(`slot-${n}`)) n++;
  return `slot-${n}`;
}
