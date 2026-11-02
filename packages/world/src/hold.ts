/**
 * Built factories held at their build (A92, A104): what a held factory's
 * links may take of each part, and the link edits that would ask a held
 * factory for more than that (BF-1). Pure.
 */
import type { Model, Recipe } from '@sps/data';
import type { Factory, Link, World } from './document';
import { entryFlows } from './manual';

/** Below this (per minute), a difference is rounding noise. */
const EPS = 1e-6;

/**
 * Held at its build (A92): marked as built, under "Built factories: Hold",
 * not scaled up and not in manual mode (a manual plan can't scale, A36).
 */
export const isHeld = (world: World, f: Factory): boolean =>
  (world.defaults.builtFactories ?? 'hold') === 'hold' &&
  f.built !== undefined &&
  !f.built.grow &&
  f.manual?.enabled !== true;

/**
 * What a held factory's links may take of each part, fixed and pull links
 * together (A104): its built For links rate (the snapshot's outputs less
 * Kept), or, when its built recipe groups make more of the part than that,
 * all they make beyond what they use, less Kept. So a byproduct the build
 * leaves over can be linked without scaling up. Without `model`, the
 * snapshot's rates alone. Parts at 0 are left out.
 */
export function holdCaps(f: Factory, model?: Pick<Model, 'recipes'>): Map<string, number> {
  const caps = new Map<string, number>();
  if (!f.built) return caps;
  const add = (m: Map<string, number>, item: string, rate: number) =>
    m.set(item, (m.get(item) ?? 0) + rate);
  for (const o of f.built.outputs) add(caps, o.item, o.rate);
  if (model) {
    const recipes = new Map<string, Recipe>(model.recipes.map((r) => [r.id, r]));
    const net = new Map<string, number>();
    for (const e of f.built.entries) {
      const r = recipes.get(e.recipe);
      if (!r || !(e.machines > 0)) continue;
      const { inputs, outputs } = entryFlows(r, e.machines);
      for (const o of outputs) add(net, o.item, o.rate);
      for (const i of inputs) add(net, i.item, -i.rate);
    }
    for (const [item, rate] of net) if (rate > (caps.get(item) ?? 0)) caps.set(item, rate);
  }
  for (const k of f.built.kept ?? []) add(caps, k.item, -k.rate);
  for (const [item, rate] of caps) if (!(rate > EPS)) caps.delete(item);
  return caps;
}

/** One part a link edit asks of a held factory beyond its cap (BF-1). */
export interface Overrun {
  factory: string;
  item: string;
  /** Its fixed links of the part after the edit, per minute. */
  fixed: number;
  /** What its links may take of the part (`holdCaps`). */
  cap: number;
  /** Held factories upstream on pull links that scaling it up drags along, sorted. */
  upstream: string[];
}

const fixedTotal = (links: readonly Link[], from: string, item: string): number =>
  links.reduce(
    (s, l) => s + (l.from === from && l.item === item && l.mode.kind === 'fixed' ? l.mode.rate : 0),
    0,
  );

/**
 * The parts for which a link edit (`before` → `after`) takes a held
 * factory's fixed links above its cap, and higher than they were (BF-1):
 * a new fixed link, a higher rate, pull switched to fixed, or a link moved
 * to another source. `cap` gives the cap per factory and part, as the last
 * world solve found it (`FactoryResult.heldCaps`).
 */
export function fixedOverruns(
  before: World,
  after: World,
  cap: (factory: string, item: string) => number,
): Overrun[] {
  const out: Overrun[] = [];
  for (const f of [...after.factories].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!isHeld(after, f)) continue;
    const items = new Set(
      after.links.filter((l) => l.from === f.id && l.mode.kind === 'fixed').map((l) => l.item),
    );
    for (const item of [...items].sort()) {
      const fixed = fixedTotal(after.links, f.id, item);
      const c = cap(f.id, item);
      if (fixed > c + EPS && fixed > fixedTotal(before.links, f.id, item) + EPS)
        out.push({ factory: f.id, item, fixed, cap: c, upstream: heldUpstream(after, f.id) });
    }
  }
  return out;
}

/** The held factories upstream of `id` on pull links, as "Scale up" lifts them (A92), sorted. */
export function heldUpstream(world: World, id: string): string[] {
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const at = queue.shift()!;
    for (const l of world.links)
      if (l.to === at && l.mode.kind === 'pull' && !seen.has(l.from)) {
        seen.add(l.from);
        queue.push(l.from);
      }
  }
  seen.delete(id);
  const held = new Set(world.factories.filter((f) => isHeld(world, f)).map((f) => f.id));
  return [...seen].filter((x) => held.has(x)).sort();
}
