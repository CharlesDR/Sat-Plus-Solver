/**
 * Resource-limit edits (A33): pure, so the editor's rules are unit-tested.
 * A resource that is on with no limit is left out of the map, so a factory
 * with no limits has `{}` and its solve request stays unchanged.
 */
import type { RawResource } from '@sps/solver';
import type { Factory, ResourceLimit } from '@sps/world';
import type { CatalogResource } from '../solver/protocol';

type Limits = Factory['resources'];

function put(limits: Limits, item: string, limit: ResourceLimit): Limits {
  const rest = Object.fromEntries(Object.entries(limits).filter(([k]) => k !== item));
  return limit.enabled && limit.max === undefined ? rest : { ...rest, [item]: limit };
}

/** Turns a resource on or off, keeping its limit for when it is back on. */
export function setEnabled(limits: Limits, item: string, enabled: boolean): Limits {
  const max = limits[item]?.max;
  return put(limits, item, { enabled, ...(max !== undefined ? { max } : {}) });
}

/** Sets or (with `undefined`) clears a resource's limit. */
export function setMax(limits: Limits, item: string, max: number | undefined): Limits {
  const enabled = limits[item]?.enabled ?? true;
  return put(limits, item, { enabled, ...(max !== undefined ? { max } : {}) });
}

/** The most the map's node pool can extract per minute; `undefined` for unlimited resources. */
export function mapMax(
  r: CatalogResource,
  pool: Readonly<Record<string, number>>,
): number | undefined {
  if (!r.limited || !r.nodes) return undefined;
  return r.nodes.reduce((s, n) => s + (pool[n.id] ?? n.count) * n.rate, 0);
}

/** The catalog's resources as `allocateRemaining` takes them, with the world's pool edits. */
export function rawResourcesOf(
  resources: readonly CatalogResource[],
  pool: Readonly<Record<string, number>>,
): RawResource[] {
  return resources.map((r) => {
    const max = mapMax(r, pool);
    return { item: r.id, limited: r.limited, ...(max !== undefined ? { mapMax: max } : {}) };
  });
}

/** The editor's heading: how many resources are off and how many are limited. */
export function limitsLabel(limits: Limits): string {
  const all = Object.values(limits);
  const off = all.filter((l) => !l.enabled).length;
  const limited = all.filter((l) => l.enabled && l.max !== undefined).length;
  const parts = [...(off ? [`${off} off`] : []), ...(limited ? [`${limited} limited`] : [])];
  return parts.length ? parts.join(', ') : 'all on, no limits';
}
