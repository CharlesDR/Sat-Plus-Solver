/** Test helpers for the persistence modules. */
import { createFactory, createWorld, type World } from '@sps/world';

/** An in-memory `Storage`; `quota` caps the total stored characters, like a full browser store. */
export function memoryStorage(quota = Infinity): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => {
      const before = data.get(k);
      data.set(k, String(v));
      if (used() > quota) {
        if (before === undefined) data.delete(k);
        else data.set(k, before);
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
    },
  };
}

/** A `Storage` whose every access throws, like a browser with storage blocked. */
export function blockedStorage(): Storage {
  const no = () => {
    throw new DOMException('Access is denied.', 'SecurityError');
  };
  return { length: 0, clear: no, getItem: no, key: no, removeItem: no, setItem: no };
}

/**
 * A world of `n` factories with varied names and notes, so it compresses
 * like a real save rather than like one repeated string.
 */
export function bigWorld(n: number, seed = 1): World {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const word = () =>
    Array.from({ length: 4 + Math.floor(rand() * 6) }, () =>
      String.fromCharCode(97 + Math.floor(rand() * 26)),
    ).join('');
  const w = createWorld('feedfacecafebeef');
  w.factories = Array.from({ length: n }, (_, k) => {
    const f = createFactory(`factory-${k + 1}`, `${word()} ${word()}`);
    f.request.targets = [{ item: 'iron-plate', rate: Math.round(rand() * 1e4) / 100 }];
    f.notes = Array.from({ length: 6 }, word).join(' ');
    return f;
  });
  w.links = w.factories.slice(1).map((f, k) => ({
    id: `link-${k + 1}`,
    from: w.factories[k]!.id,
    to: f.id,
    item: 'iron-plate',
    mode: { kind: 'fixed', rate: Math.round(rand() * 1e4) / 100 },
  }));
  return w;
}
