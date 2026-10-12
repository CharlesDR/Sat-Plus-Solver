/**
 * Production order (UX-B, A78): recipes from the raw end of the line to the
 * targets. A recipe's depth is the longest chain of plan recipes feeding it:
 * 0 when nothing it takes is made in the plan (recipes fed only by imports)
 * and for extraction recipes (raw, like the flowchart's resource nodes, even
 * when they take a fluid), else one more than its deepest feeder.
 *
 * Loops (water back from turbines, a byproduct fed back, a breeding loop) are
 * broken where they are weakest. Lines are taken in three rounds, each line
 * kept unless it closes a loop with the lines already kept: main-product
 * lines (a recipe's first output) first, then byproduct lines, then the lines
 * out of recyclers (recipes that take only byproducts, such as a turbine on a
 * smelter's steam). So the turbine comes after the smelter, and its water
 * doesn't pull every water user after it. Ties go by name, then id, so the
 * order is deterministic.
 *
 * The plan summary's Recipes table and the CLI both use it, so they agree.
 */
import type { ItemRate } from '@sps/solver';

export interface OrderedRecipe {
  id: string;
  name: string;
  inputs: readonly Pick<ItemRate, 'item'>[];
  /** In recipe order: the first is the main product. */
  outputs: readonly Pick<ItemRate, 'item'>[];
  /** Extraction recipes (miners, wells) draw on a node: raw, at depth 0 whatever fluid they take. */
  node?: string | undefined;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Each recipe's depth from the raw inputs, by recipe id. */
export function productionDepths(recipes: readonly OrderedRecipe[]): Map<string, number> {
  const ids = recipes.map((r) => r.id).sort(byString);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  /** Who makes each item, and whether it is their main product. */
  const makers = new Map<string, { id: string; main: boolean }[]>();
  for (const id of ids)
    byId
      .get(id)!
      .outputs.forEach((f, k) =>
        makers.set(f.item, [...(makers.get(f.item) ?? []), { id, main: k === 0 }]),
      );
  const recycler = (id: string) => {
    const inputs = byId.get(id)!.inputs.map((f) => makers.get(f.item) ?? []);
    return inputs.length > 0 && inputs.every((m) => m.length > 0 && m.every((x) => !x.main));
  };
  // One line per feeder and consumer, in its strongest round (0 main, 1 byproduct, 2 out of a recycler).
  const lines = new Map<string, { from: string; to: string; round: number }>();
  for (const to of ids)
    if (byId.get(to)!.node === undefined)
      for (const f of byId.get(to)!.inputs)
        for (const m of makers.get(f.item) ?? []) {
          if (m.id === to) continue;
          const round = !m.main ? 1 : recycler(m.id) ? 2 : 0;
          const key = `${m.id}\n${to}`;
          const known = lines.get(key);
          if (!known || round < known.round) lines.set(key, { from: m.id, to, round });
        }

  // Keep each line unless its consumer already reaches its feeder.
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const feeders = new Map<string, string[]>(ids.map((id) => [id, []]));
  const reaches = (start: string, goal: string) => {
    const seen = new Set([start]);
    const todo = [start];
    while (todo.length) {
      const id = todo.pop()!;
      if (id === goal) return true;
      for (const next of out.get(id)!)
        if (!seen.has(next)) {
          seen.add(next);
          todo.push(next);
        }
    }
    return false;
  };
  const sorted = [...lines.values()].sort(
    (a, b) => a.round - b.round || byString(a.to, b.to) || byString(a.from, b.from),
  );
  for (const { from, to } of sorted)
    if (!reaches(to, from)) {
      out.get(from)!.push(to);
      feeders.get(to)!.push(from);
    }

  // The longest chain over the kept lines, which form no loop.
  const depth = new Map<string, number>();
  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const d = Math.max(-1, ...feeders.get(id)!.map(visit)) + 1;
    depth.set(id, d);
    return d;
  };
  for (const id of ids) visit(id);
  return depth;
}

/** The recipes in production order: raw end first, targets last. */
export function productionOrder<T extends OrderedRecipe>(recipes: readonly T[]): T[] {
  const depth = productionDepths(recipes);
  return [...recipes].sort(
    (a, b) =>
      depth.get(a.id)! - depth.get(b.id)! || a.name.localeCompare(b.name) || byString(a.id, b.id),
  );
}
