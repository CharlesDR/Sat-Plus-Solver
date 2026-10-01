/**
 * Draft rows for item + number lists (targets, imports): the text a user is
 * typing, kept apart from the document, which only ever holds valid entries.
 */
import { useMemo } from 'react';
import type { CatalogItem } from '../solver/protocol';

export interface DraftRow {
  key: number;
  itemText: string;
  numberText: string;
}

/** Looks an item up by id or by name, case-insensitively. */
export function useItemLookup(catalog: readonly CatalogItem[]) {
  return useMemo(() => {
    const m = new Map<string, CatalogItem>();
    for (const c of catalog) {
      m.set(c.name.toLowerCase(), c);
      m.set(c.id, c);
    }
    return {
      find: (text: string) => m.get(text.trim().toLowerCase()),
      name: (id: string) => m.get(id)?.name ?? id,
    };
  }, [catalog]);
}

/** A positive finite number, or `undefined`. */
export function positive(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

let nextKey = 1;
export const newRowKey = () => nextKey++;
