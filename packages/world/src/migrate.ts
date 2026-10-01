/**
 * Upgrades a saved `World` document to `WORLD_VERSION` (CLAUDE.md: every
 * shape change bumps `World.v` and adds a migration). Pure: never mutates
 * its input.
 */
import { WORLD_VERSION, type World } from './document';

export class WorldMigrationError extends Error {}

type Doc = Record<string, unknown>;

/** v1 → v2 (M5): world defaults gain `wholeMachines` and `costImports`, both off. */
function v1ToV2(doc: Doc): Doc {
  const defaults = (doc.defaults ?? {}) as Doc;
  return {
    ...doc,
    meta: { ...(doc.meta as Doc), v: 2 },
    defaults: { ...defaults, wholeMachines: false, costImports: false },
  };
}

const MIGRATIONS: Record<number, (doc: Doc) => Doc> = { 1: v1ToV2 };

/** Returns `doc` upgraded to the current version; throws on a newer or malformed document. */
export function migrateWorld(doc: unknown): World {
  if (typeof doc !== 'object' || doc === null)
    throw new WorldMigrationError('Not a world document.');
  let out = JSON.parse(JSON.stringify(doc)) as Doc;
  const version = () => (out.meta as Doc | undefined)?.v;
  const v = version();
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
    throw new WorldMigrationError(`Missing or invalid world version (${String(v)}).`);
  if (v > WORLD_VERSION)
    throw new WorldMigrationError(
      `This world was saved by a newer version (v${v}); this app reads up to v${WORLD_VERSION}.`,
    );
  for (let at = v; at < WORLD_VERSION; at++) out = MIGRATIONS[at]!(out);
  return out as unknown as World;
}
