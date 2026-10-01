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

/** Exclusion list → per-recipe toggles (`false` for each excluded id). */
const toToggles = (exclude: unknown): Record<string, boolean> =>
  Object.fromEntries(
    (Array.isArray(exclude) ? (exclude as string[]) : []).map((id) => [id, false]),
  );

/**
 * v2 → v3 (M6): `excludeRecipes` lists become per-recipe toggles, and the
 * max-tier filter arrives, off. A v2 factory's exclusions added to the
 * world's; as `false` toggles over the world's they still do.
 */
function v2ToV3(doc: Doc): Doc {
  const { excludeRecipes, ...defaults } = (doc.defaults ?? {}) as Doc;
  const factories = ((doc.factories ?? []) as Doc[]).map((f) => {
    const { excludeRecipes: ex, ...request } = (f.request ?? {}) as Doc;
    return { ...f, request: ex === undefined ? request : { ...request, recipes: toToggles(ex) } };
  });
  return {
    ...doc,
    meta: { ...(doc.meta as Doc), v: 3 },
    factories,
    defaults: { ...defaults, recipes: toToggles(excludeRecipes), maxTier: null },
  };
}

const MIGRATIONS: Record<number, (doc: Doc) => Doc> = { 1: v1ToV2, 2: v2ToV3 };

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
