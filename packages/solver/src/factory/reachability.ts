import type { Flow, Recipe } from '@sps/data';

/**
 * The flows of `r` that can run once `ready` holds for each of its inputs: all
 * of them, or for a heater (A17) whose boiler input is missing, only the
 * heater side (a heater can burn fuel with its boiler idle).
 */
function runnableOutputs(r: Recipe, ready: (f: Flow) => boolean): Flow[] | undefined {
  if (r.inputs.every(ready)) return r.outputs;
  if (r.heater && r.inputs.every((f) => !f.heater || ready(f)))
    return r.outputs.filter((f) => f.heater);
  return undefined;
}

/** Forward fixpoint: adds to `have` every item a recipe can make from it. */
function close(recipes: readonly Recipe[], have: Set<string>): void {
  for (let grew = true; grew;) {
    grew = false;
    for (const r of recipes) {
      for (const f of runnableOutputs(r, (g) => have.has(g.item)) ?? []) {
        if (have.has(f.item)) continue;
        have.add(f.item);
        grew = true;
      }
    }
  }
}

/** Loop gains are capped so a growing walk stays finite. */
const GAIN_CAP = 1e6;
/** A loop counts only when it returns more than it took, beyond float noise. */
const GAIN_EPS = 1e-9;

/**
 * The next starter (A74): an item outside `have` on a self-sustaining loop.
 * Each recipe whose inputs are all in `have` but one, `a`, links `a` to each
 * output `b` outside `have` with gain `b`/`a` per minute. An item is a starter
 * when some walk of links leads back to it with gain above 1: running that
 * walk's recipes nets the item positive, with every other loop item balanced.
 * Candidates are tried by the largest gain of a step that consumes them (the
 * breeding stock: a Terrarium multiplies its slug ×5, the Hatchery its egg ×1),
 * then by id.
 */
function nextStarter(recipes: readonly Recipe[], have: ReadonlySet<string>): string | undefined {
  const links: { from: string; to: string; gain: number }[] = [];
  for (const r of recipes) {
    const missing = r.inputs.filter((f) => !have.has(f.item));
    if (missing.length !== 1 || missing[0]!.rate <= 0) continue;
    const a = missing[0]!;
    for (const b of r.outputs)
      if (!have.has(b.item) && b.rate > 0)
        links.push({ from: a.item, to: b.item, gain: b.rate / a.rate });
  }
  const score = new Map<string, number>();
  for (const l of links) score.set(l.from, Math.max(score.get(l.from) ?? 0, l.gain));
  const candidates = [...score].sort(([a, ga], [b, gb]) => gb - ga || (a < b ? -1 : a > b ? 1 : 0));
  const size = new Set(links.flatMap((l) => [l.from, l.to])).size;
  for (const [seed] of candidates) {
    const best = new Map([[seed, 1]]);
    let back = 0;
    for (let round = 0; round < size && back <= 1 + GAIN_EPS; round++) {
      let changed = false;
      for (const l of links) {
        const g = best.get(l.from);
        if (g === undefined) continue;
        const v = Math.min(g * l.gain, GAIN_CAP);
        if (l.to === seed) back = Math.max(back, v);
        else if (v > (best.get(l.to) ?? 0) * (1 + GAIN_EPS)) {
          best.set(l.to, v);
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (back > 1 + GAIN_EPS) return seed;
  }
  return undefined;
}

/**
 * What the given sources can make (§3.5): a recipe can run once all of its
 * inputs are producible, and then its outputs are. Recipes with no inputs
 * (extraction) can always run, and a heater's exhaust needs only its fuel
 * (A17). A self-sustaining loop, such as slug breeding, runs from a starter:
 * an item of its own the player brings once (A74). Node budgets are ignored
 * here: running out of nodes is an infeasibility (elastic re-solve), not
 * unreachability.
 */
export function reach(
  recipes: readonly Recipe[],
  sources: Iterable<string>,
): { have: Set<string>; starters: string[] } {
  const have = new Set(sources);
  const starters: string[] = [];
  close(recipes, have);
  for (let s = nextStarter(recipes, have); s !== undefined; s = nextStarter(recipes, have)) {
    starters.push(s);
    have.add(s);
    close(recipes, have);
  }
  return { have, starters: starters.sort() };
}

/**
 * The starters a solved plan needs (A74): with `steps` the plan's own recipe
 * flows, the items that must be brought once so that every step can start
 * from what the plan imports. The plan's balance already proves its loops
 * sustain themselves, so this only picks which loop items to name: while a
 * step is stuck, the missing `bred` input (one only a loop makes) consumed by
 * the most multiplying step (the breeding stock) is added, ties by id. A
 * recycling loop of items the map also yields, such as Muriatic Acid, names
 * none. Sorted.
 */
export function planStarters(
  steps: readonly { inputs: readonly Flow[]; outputs: readonly Flow[] }[],
  imported: Iterable<string>,
  bred: ReadonlySet<string>,
): string[] {
  const live = steps.map((s) => ({
    inputs: s.inputs.filter((f) => f.rate > 0),
    outputs: s.outputs.filter((f) => f.rate > 0),
  }));
  const have = new Set(imported);
  const starters: string[] = [];
  for (;;) {
    for (let grew = true; grew;) {
      grew = false;
      for (const s of live)
        if (s.inputs.every((f) => have.has(f.item)))
          for (const f of s.outputs)
            if (!have.has(f.item)) {
              have.add(f.item);
              grew = true;
            }
    }
    const score = new Map<string, number>();
    for (const s of live) {
      const most = Math.max(0, ...s.outputs.map((f) => f.rate));
      for (const f of s.inputs)
        if (!have.has(f.item) && bred.has(f.item))
          score.set(f.item, Math.max(score.get(f.item) ?? 0, most / f.rate));
    }
    const next = [...score].sort(([a, ga], [b, gb]) => gb - ga || (a < b ? -1 : a > b ? 1 : 0))[0];
    if (!next) return starters.sort();
    starters.push(next[0]);
    have.add(next[0]);
  }
}

/**
 * What a plan for `wanted` may make (A74): loops join only when a wanted item
 * can't be made without them. A plan that doesn't need a loop never grows a
 * slug farm just to save a sliver of a node with Slug Slime in its miners.
 * `bred` are the items only a loop makes.
 */
export function reachableFor(
  recipes: readonly Recipe[],
  sources: Iterable<string>,
  wanted: readonly string[],
): { have: Set<string>; bred: Set<string> } {
  const plain = new Set(sources);
  close(recipes, plain);
  if (wanted.every((i) => plain.has(i))) return { have: plain, bred: new Set() };
  const { have } = reach(recipes, plain);
  return { have, bred: new Set([...have].filter((i) => !plain.has(i))) };
}

/** Items producible from the given sources, loops included (see `reach`). */
export function producible(recipes: readonly Recipe[], sources: Iterable<string>): Set<string> {
  return reach(recipes, sources).have;
}

/**
 * Reverse-reachability pruning (§5): keeps the recipes that can run from the
 * sources and produce something the demand transitively needs. A recipe whose
 * outputs are all unneeded can only add cost, since surplus is free disposal.
 */
export function prune(
  recipes: readonly Recipe[],
  available: ReadonlySet<string>,
  demanded: Iterable<string>,
): Recipe[] {
  const runnable = recipes.filter((r) => runnableOutputs(r, (f) => available.has(f.item)));
  const needed = new Set(demanded);
  const kept = new Set<Recipe>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of runnable) {
      if (kept.has(r) || !r.outputs.some((f) => needed.has(f.item))) continue;
      kept.add(r);
      grew = true;
      for (const f of r.inputs) needed.add(f.item);
    }
  }
  return runnable.filter((r) => kept.has(r));
}

/**
 * Disabled recipes that would make `item` producible, closest first: recipes
 * that fix it on their own when enabled (direct producers of the item before
 * upstream ones), then direct producers that need more than one recipe
 * enabled. Ties break by id, so the order is stable.
 */
export function closestFixes(
  item: string,
  enabled: readonly Recipe[],
  disabled: readonly Recipe[],
  sources: readonly string[],
  limit = 5,
): string[] {
  const all = producible([...enabled, ...disabled], sources);
  if (!all.has(item)) return [];
  const direct = (r: Recipe) => r.outputs.some((f) => f.item === item);
  const ranked: { id: string; rank: number }[] = [];
  for (const r of disabled) {
    if (producible([...enabled, r], sources).has(item))
      ranked.push({ id: r.id, rank: direct(r) ? 0 : 1 });
    else if (direct(r) && runnableOutputs(r, (f) => all.has(f.item)))
      ranked.push({ id: r.id, rank: 2 });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit)
    .map((r) => r.id);
}
