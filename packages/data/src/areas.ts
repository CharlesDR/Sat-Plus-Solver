/**
 * Flowchart areas (A57): which area each item's recipes are drawn in, from
 * the curated list in data/areas.json and each item's base-resource
 * signature.
 *
 * An item's signature is the set of raw resources its simplest route needs:
 * the route through base (non-alternate) recipes with the fewest raw
 * resources, then the fewest steps, then the first recipe id. Alternates
 * are used only for items no base route reaches. Its depth is the number of
 * steps on that route, raw resources being 0 and a miner's direct output 1.
 */
import type { Issues } from './issues';
import type { Area, Item, Recipe } from './model';
import type { AreasConfig } from './raw';

/** How an item got its area, for the build report. */
export type AreaReason = 'listed' | 'raw' | 'signature' | 'nearest' | 'fallback';

export interface ItemArea {
  item: string;
  area: string;
  reason: AreaReason;
  /** Raw resources of its simplest route, sorted; empty when no route reaches it. */
  signature: string[];
  /** Steps from raw on that route; -1 when no route reaches it. */
  depth: number;
}

export interface AreasResult {
  areas: Area[];
  items: ItemArea[];
}

type Route = { signature: string[]; depth: number; recipe: string; alternate: boolean };

const shorter = (a: Route, b: Route | undefined) =>
  !b ||
  a.signature.length < b.signature.length ||
  (a.signature.length === b.signature.length &&
    (a.depth < b.depth || (a.depth === b.depth && a.recipe < b.recipe)));

/** Each item's simplest route from raw resources (see the file comment). */
export function simplestRoutes(
  items: readonly Item[],
  recipes: readonly Recipe[],
): Map<string, Route> {
  const counted = new Set(
    items.filter((i) => i.form === 'solid' || i.form === 'fluid').map((i) => i.id),
  );
  const raw = new Set(recipes.flatMap((r) => (r.extracts ? [r.extracts.item] : [])));
  const best = new Map<string, Route>();
  for (const id of raw) best.set(id, { signature: [id], depth: 0, recipe: '', alternate: false });
  const usable = recipes
    .filter((r) => r.kind === 'production' || r.kind === 'extraction')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const alternates of [false, true]) {
    const pass = usable.filter((r) => alternates || !r.alternate);
    // Relax until nothing improves; every pass that changes something
    // shortens some route, so this ends.
    for (let changed = true; changed;) {
      changed = false;
      for (const r of pass) {
        const sig = new Set<string>(r.extracts ? [r.extracts.item] : []);
        let depth = 0;
        let reached = true;
        for (const f of r.inputs) {
          if (!counted.has(f.item)) continue;
          const from = best.get(f.item);
          if (!from) {
            reached = false;
            break;
          }
          for (const s of from.signature) sig.add(s);
          depth = Math.max(depth, from.depth);
        }
        if (!reached) continue;
        const route: Route = {
          signature: [...sig].sort(),
          depth: depth + 1,
          recipe: r.id,
          alternate: alternates,
        };
        for (const f of r.outputs) {
          if (!counted.has(f.item) || raw.has(f.item)) continue;
          const known = best.get(f.item);
          // Alternates only reach items no base route reaches.
          if (alternates && known && !known.alternate) continue;
          if (shorter(route, known)) {
            best.set(f.item, route);
            changed = true;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Validates data/areas.json against the items and places every solid and
 * fluid item in an area. Unknown part names, a part listed twice, and a
 * missing or repeated `raw`, `targets` or `fallback` area are errors.
 */
export function buildAreas(
  config: AreasConfig,
  items: readonly Item[],
  recipes: readonly Recipe[],
  issues: Issues,
): AreasResult | undefined {
  const before = issues.errors.length;
  const byName = new Map(items.map((i) => [i.name, i.id]));
  const known = (name: string, where: string) => {
    const id = byName.get(name);
    if (id === undefined)
      issues.error('areas.unknownPart', `data/areas.json: ${where}: unknown part "${name}"`);
    return id;
  };
  const ids = new Set<string>();
  for (const a of config.areas) {
    if (ids.has(a.id)) issues.error('areas.duplicate', `data/areas.json: area "${a.id}" twice`);
    ids.add(a.id);
  }
  for (const rule of ['raw', 'targets', 'fallback'] as const) {
    const n = config.areas.filter((a) => a.rule === rule).length;
    if (n !== 1)
      issues.error('areas.rule', `data/areas.json: ${n} areas have rule "${rule}"; one must`);
  }
  const listed = new Map<string, string>();
  for (const a of config.areas)
    for (const name of a.items) {
      const id = known(name, a.id);
      if (id === undefined) continue;
      const other = listed.get(id);
      if (other !== undefined)
        issues.error('areas.twice', `data/areas.json: "${name}" is in "${other}" and "${a.id}"`);
      else listed.set(id, a.id);
    }
  const utility = new Set(config.utility.flatMap((n) => known(n, 'utility') ?? []));
  const signatures = config.areas.flatMap((a) =>
    a.signature
      ? [
          {
            area: a.id,
            sig: a.signature
              .flatMap((n) => known(n, a.id) ?? [])
              .sort()
              .join('+'),
          },
        ]
      : [],
  );
  if (issues.errors.length > before) return undefined;

  const raw = config.areas.find((a) => a.rule === 'raw')!.id;
  const fallback = config.areas.find((a) => a.rule === 'fallback')!.id;
  const routes = simplestRoutes(items, recipes);
  const core = (sig: readonly string[]) => sig.filter((s) => !utility.has(s));
  // Each family's resources: everything its listed items need.
  const families = config.areas
    .filter((a) => a.rule === undefined)
    .map((a) => {
      const res = new Set<string>();
      for (const name of a.items)
        for (const s of core(routes.get(byName.get(name)!)?.signature ?? [])) res.add(s);
      return { area: a.id, res };
    });

  const placed: ItemArea[] = [];
  for (const it of items) {
    if (it.form !== 'solid' && it.form !== 'fluid') continue;
    const route = routes.get(it.id);
    const signature = route?.signature ?? [];
    const base = { item: it.id, signature, depth: route?.depth ?? -1 };
    const list = listed.get(it.id);
    const mine = core(signature);
    let at: Omit<ItemArea, keyof typeof base> | undefined;
    if (list !== undefined) at = { area: list, reason: 'listed' };
    else if (route && route.depth <= 1) at = { area: raw, reason: 'raw' };
    else {
      const sig = [...mine].sort().join('+');
      const exact = mine.length ? signatures.find((s) => s.sig === sig) : undefined;
      if (exact) at = { area: exact.area, reason: 'signature' };
      else {
        // The family sharing the largest part of its resources (Jaccard), the
        // first in production order on a tie.
        let best: { area: string; score: number } | undefined;
        for (const f of families) {
          const shared = mine.filter((s) => f.res.has(s)).length;
          const score = shared / (f.res.size + mine.length - shared || 1);
          if (shared > 0 && (!best || score > best.score)) best = { area: f.area, score };
        }
        at = best ? { area: best.area, reason: 'nearest' } : { area: fallback, reason: 'fallback' };
      }
    }
    placed.push({ ...base, ...at });
  }
  return {
    areas: config.areas.map((a) => ({
      id: a.id,
      name: a.name,
      ...(a.rule ? { rule: a.rule } : {}),
    })),
    items: placed,
  };
}
