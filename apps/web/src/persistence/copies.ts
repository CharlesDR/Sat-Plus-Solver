/**
 * Copies of one world (DF-13, A109). Every copy of a world carries its
 * `meta.worldId`; opening a share link, file or save with the open world's
 * id says whether it is newer or older than the open one, from the two
 * `meta.savedAt` times, and offers Replace, Keep both or Cancel.
 */
import type { World } from '@sps/world';

export interface CopyCheck {
  /** The copy being opened, against the open world; a missing time is the oldest. */
  age: 'newer' | 'older' | 'same';
  /** Saved times (ISO 8601), when known. */
  incoming?: string;
  open?: string;
}

const time = (w: World) => {
  const t = Date.parse(w.meta.savedAt ?? '');
  return Number.isNaN(t) ? -Infinity : t;
};

/** How `incoming` compares with the `open` world, or `undefined` when they are different worlds. */
export function compareCopies(open: World, incoming: World): CopyCheck | undefined {
  const id = open.meta.worldId;
  if (id === undefined || incoming.meta.worldId !== id) return undefined;
  const a = time(incoming);
  const b = time(open);
  return {
    age: a > b ? 'newer' : a < b ? 'older' : 'same',
    ...(incoming.meta.savedAt !== undefined ? { incoming: incoming.meta.savedAt } : {}),
    ...(open.meta.savedAt !== undefined ? { open: open.meta.savedAt } : {}),
  };
}

/** A new world id: 16 random hex digits (works without a secure context, unlike `randomUUID`). */
export function randomWorldId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/** A saved time for people: local date and time, or "not recorded". */
export function savedTime(iso: string | undefined): string {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? 'not recorded' : new Date(t).toLocaleString();
}

/** The slot "Keep both" saves the open world in: its name and when it was saved. */
export function keepBothName(
  world: World,
  format: (iso: string | undefined) => string = savedTime,
): string {
  const name = world.meta.name?.trim() || 'Unnamed world';
  return world.meta.savedAt === undefined
    ? `${name} (kept)`
    : `${name} (saved ${format(world.meta.savedAt)})`;
}
