import { createHash } from 'node:crypto';

/** Lowercase ASCII slug: "Iron Plate" → "iron-plate", "A.I. Fluid Packer" → "a-i-fluid-packer". */
export function slug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function shortHash(content: string, length = 6): string {
  return createHash('sha256').update(content).digest('hex').slice(0, length);
}

/**
 * Assigns stable ids: the slug of the name, plus `~<content hash>` for every
 * entry whose slug collides with another. The hash covers the entry's content,
 * so ids do not depend on array order.
 */
export function assignIds<T>(
  entries: readonly T[],
  name: (e: T) => string,
  content: (e: T) => string = (e) => JSON.stringify(e),
): Map<T, string> {
  const bySlug = new Map<string, T[]>();
  for (const e of entries) {
    const s = slug(name(e));
    bySlug.set(s, [...(bySlug.get(s) ?? []), e]);
  }
  const ids = new Map<T, string>();
  for (const [s, group] of bySlug) {
    if (group.length === 1) {
      ids.set(group[0]!, s);
      continue;
    }
    const seen = new Set<string>();
    for (const e of group) {
      let id = `${s}~${shortHash(content(e))}`;
      // Byte-identical duplicates: disambiguate deterministically by occurrence.
      for (let k = 2; seen.has(id); k++) id = `${s}~${shortHash(content(e))}-${k}`;
      seen.add(id);
      ids.set(e, id);
    }
  }
  return ids;
}
