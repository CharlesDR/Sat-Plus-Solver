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

/**
 * v3 → v4 (A33): the factory's node budget becomes per-resource limits.
 * `'pool'` becomes no limits. An explicit budget turns off each resource
 * whose node caps are all 0; its other caps are dropped (a rate limit needs
 * the model's extraction rates), so those resources are limited only by the
 * map's node pool.
 */
function v3ToV4(doc: Doc): Doc {
  const factories = ((doc.factories ?? []) as Doc[]).map((f) => {
    const { nodeBudget, ...rest } = f;
    const caps = new Map<string, number>();
    if (typeof nodeBudget === 'object' && nodeBudget !== null)
      for (const [node, cap] of Object.entries(nodeBudget as Record<string, unknown>)) {
        // Node ids are `node:<resource item id>:<purity>`.
        const resource = node.split(':')[1];
        if (resource) caps.set(resource, (caps.get(resource) ?? 0) + (Number(cap) || 0));
      }
    const resources = Object.fromEntries(
      [...caps]
        .filter(([, total]) => total === 0)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([resource]) => [resource, { enabled: false }]),
    );
    return { ...rest, resources };
  });
  return { ...doc, meta: { ...(doc.meta as Doc), v: 4 }, factories };
}

/**
 * v4 → v5: a world still on the old default objective stack (O1 alone)
 * moves to the new default, scarcity-weighted resources (O2), so its new
 * factories start on O2. Any other world stack and every factory override
 * stay as they are.
 */
function v4ToV5(doc: Doc): Doc {
  const defaults = (doc.defaults ?? {}) as Doc;
  const stack = defaults.objectives;
  const old = Array.isArray(stack) && stack.length === 1 && stack[0] === 'resources';
  return {
    ...doc,
    meta: { ...(doc.meta as Doc), v: 5 },
    defaults: old ? { ...defaults, objectives: ['scarcity'] } : defaults,
  };
}

/** v5 → v6 (A35): factories gain plan tweaks, none yet. */
function v5ToV6(doc: Doc): Doc {
  const factories = ((doc.factories ?? []) as Doc[]).map((f) => ({ ...f, tweaks: [] }));
  return { ...doc, meta: { ...(doc.meta as Doc), v: 6 }, factories };
}

/** v6 → v7 (A36): factories may carry a manual plan; none do yet. */
function v6ToV7(doc: Doc): Doc {
  return { ...doc, meta: { ...(doc.meta as Doc), v: 7 } };
}

/** v7 → v8 (A39): world defaults gain "Avoid fluid byproducts", on like a new world's. */
function v7ToV8(doc: Doc): Doc {
  const defaults = (doc.defaults ?? {}) as Doc;
  return {
    ...doc,
    meta: { ...(doc.meta as Doc), v: 8 },
    defaults: { ...defaults, avoidFluidByproducts: true },
  };
}

/** v8 → v9 (A44): factories may carry a build mark; none do yet. */
function v8ToV9(doc: Doc): Doc {
  return { ...doc, meta: { ...(doc.meta as Doc), v: 9 } };
}

/** v9 → v10 (A45, A49): factories may sit inside other factories; none do yet. */
function v9ToV10(doc: Doc): Doc {
  return { ...doc, meta: { ...(doc.meta as Doc), v: 10 } };
}

/** v10 → v11 (A61): factories may carry flowchart area settings; none do yet. */
function v10ToV11(doc: Doc): Doc {
  return { ...doc, meta: { ...(doc.meta as Doc), v: 11 } };
}

const MIGRATIONS: Record<number, (doc: Doc) => Doc> = {
  1: v1ToV2,
  2: v2ToV3,
  3: v3ToV4,
  4: v4ToV5,
  5: v5ToV6,
  6: v6ToV7,
  7: v7ToV8,
  8: v8ToV9,
  9: v9ToV10,
  10: v10ToV11,
};

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
