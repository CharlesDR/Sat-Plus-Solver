/**
 * Areas from a plan's pinch points (A87): instead of a fixed catalog of part
 * types, each area is a module of the plan whose work leaves it as only a few
 * parts, so it can be built as one piece fed by few belts and pipes.
 *
 * Modules come from the post-dominator tree of the plan's boxes: a box's
 * subtree is everything that only feeds that box. Bottom up, the pieces under
 * a box that are joined by lines form a module; a module of `PINCH_MIN` to
 * `PINCH_MAX` boxes becomes an area, a smaller one folds into the box it
 * feeds. What is still smaller than `PINCH_MIN` joins the neighbouring area
 * whose merge takes most parts off the borders, and single boxes then move
 * between neighbouring areas while that takes parts off the borders (raw
 * resources count once for the whole plan, so they are left out). An area is
 * named after what it sends out, and its id is made from those parts, so a
 * rename or a move sticks while the plan keeps them. Deterministic: every
 * choice follows the graph's own sorted order.
 */
import type { FactoryGraph, FlowEdge, FlowNode } from './factory';

/** Areas hold this many recipe boxes or more, where the plan allows it. */
export const PINCH_MIN = 4;
/** Areas hold at most this many recipe boxes, where the plan allows it. */
export const PINCH_MAX = 15;
/** Prefix of a pinch-point area's id, so it never meets a catalog area's id. */
export const PINCH_PREFIX = 'pp:';

const SINK = '\u0000sink';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Recipe-like boxes: what areas are built from. */
export const isBox = (n: FlowNode) =>
  n.kind === 'recipe' || n.kind === 'resource' || n.kind === 'sub-factory';

export interface PinchArea {
  id: string;
  name: string;
}

/** The parts crossing an area's border: what comes in and what goes out. */
export function areaFlows(
  edges: readonly FlowEdge[],
  at: ReadonlyMap<string, string>,
  boxes: ReadonlySet<string>,
): Map<string, { ins: Set<string>; outs: Set<string> }> {
  const out = new Map<string, { ins: Set<string>; outs: Set<string> }>();
  const of = (a: string) => {
    let f = out.get(a);
    if (!f) out.set(a, (f = { ins: new Set(), outs: new Set() }));
    return f;
  };
  for (const e of edges) {
    // Plan ends (imports, targets, byproducts) are the factory's border, so a
    // line to or from one always crosses its area's border.
    const from = boxes.has(e.source) ? at.get(e.source) : undefined;
    const to = boxes.has(e.target) ? at.get(e.target) : undefined;
    if (from !== undefined && from === to) continue;
    if (from !== undefined) of(from).outs.add(e.item);
    if (to !== undefined) of(to).ins.add(e.item);
  }
  return out;
}

/**
 * Each box's area and the areas in production order. Plan ends (imports,
 * targets, byproducts) are left for the caller to place.
 */
export function pinchAreas(graph: FactoryGraph): {
  at: Map<string, string>;
  areas: PinchArea[];
} {
  const boxes = graph.nodes.filter(isBox).map((n) => n.id);
  const boxSet = new Set(boxes);
  const index = new Map(boxes.map((b, k) => [b, k]));
  const byIndex = (a: string, b: string) => index.get(a)! - index.get(b)!;
  const succ = new Map(boxes.map((b) => [b, new Set<string>()]));
  const pred = new Map(boxes.map((b) => [b, new Set<string>()]));
  const exits = new Set<string>();
  for (const e of graph.edges) {
    const s = boxSet.has(e.source);
    const t = boxSet.has(e.target);
    if (s && t && e.source !== e.target) {
      succ.get(e.source)!.add(e.target);
      pred.get(e.target)!.add(e.source);
    } else if (s && !t) exits.add(e.source);
  }
  for (const b of boxes) if (!succ.get(b)!.size) exits.add(b);

  // Post-dominators: dominators of the reversed graph from a sink after every exit.
  const rev = (v: string): string[] =>
    v === SINK ? boxes.filter((b) => exits.has(b)) : [...pred.get(v)!].sort(byIndex);
  const order: string[] = [];
  const seen = new Set<string>([SINK]);
  const visit = (root: string) => {
    // Iterative depth-first search; `order` gets the post-order.
    const stack: { v: string; next: string[] }[] = [{ v: root, next: rev(root) }];
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const w = top.next.shift();
      if (w === undefined) {
        order.push(top.v);
        stack.pop();
      } else if (!seen.has(w)) {
        seen.add(w);
        stack.push({ v: w, next: rev(w) });
      }
    }
  };
  visit(SINK);
  // A box that reaches no exit (a closed loop) counts as one.
  for (
    let missed = boxes.find((b) => !seen.has(b));
    missed;
    missed = boxes.find((b) => !seen.has(b))
  ) {
    exits.add(missed);
    order.length = 0;
    seen.clear();
    seen.add(SINK);
    visit(SINK);
  }
  const rpo = [...order].reverse();
  const rank = new Map(rpo.map((v, k) => [v, k]));
  const idom = new Map<string, string>([[SINK, SINK]]);
  // Predecessors in the reversed graph: the sink for an exit, and the box's consumers.
  const into = (v: string) => [...(exits.has(v) ? [SINK] : []), ...succ.get(v)!];
  const meet = (a: string, b: string) => {
    let x = a;
    let y = b;
    while (x !== y) {
      while (rank.get(x)! > rank.get(y)!) x = idom.get(x)!;
      while (rank.get(y)! > rank.get(x)!) y = idom.get(y)!;
    }
    return x;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const v of rpo) {
      if (v === SINK) continue;
      let next: string | undefined;
      for (const p of into(v)) if (idom.has(p)) next = next === undefined ? p : meet(p, next);
      if (next !== undefined && idom.get(v) !== next) {
        idom.set(v, next);
        changed = true;
      }
    }
  }
  const children = new Map<string, string[]>();
  for (const v of rpo) {
    if (v === SINK) continue;
    const d = idom.get(v)!;
    children.set(d, [...(children.get(d) ?? []), v]);
  }

  // Bottom up: modules under each box close as areas or fold into it. A box
  // that would gather more than PINCH_MAX keeps its folded pieces apart.
  const closed: string[][] = [];
  const linked = (a: readonly string[], b: readonly string[]) => {
    const inB = new Set(b);
    return a.some((x) => [...succ.get(x)!, ...pred.get(x)!].some((y) => inB.has(y)));
  };
  const build = (v: string): string[] => {
    const pieces = (children.get(v) ?? []).map(build).filter((p) => p.length);
    // Pieces joined by lines are one module.
    const groups: string[][][] = [];
    for (const p of pieces) {
      const hit = groups.filter((g) => g.some((q) => linked(p, q)));
      const merged = [...hit.flat(), p];
      for (const h of hit) groups.splice(groups.indexOf(h), 1);
      groups.push(merged);
    }
    groups.sort((a, b) => byIndex(a[0]![0]!, b[0]![0]!));
    const folded: string[][] = [];
    for (const g of groups) {
      const size = g.reduce((s, p) => s + p.length, 0);
      if (size >= PINCH_MIN && size <= PINCH_MAX) closed.push(g.flat());
      else if (size < PINCH_MIN) folded.push(g.flat());
      else for (const p of g) (p.length >= PINCH_MIN ? closed : folded).push(p);
    }
    const open = v === SINK ? [] : [v, ...folded.flat()];
    if (v !== SINK && open.length <= PINCH_MAX) return open;
    closed.push(...folded);
    return v === SINK ? [] : [v];
  };
  build(SINK);

  const at = new Map<string, number>();
  closed.forEach((list, k) => list.forEach((b) => at.set(b, k)));
  const raw = new Set(
    graph.nodes.filter((n) => n.kind === 'resource').flatMap((n) => n.outputs.map((o) => o.item)),
  );
  // Lines touching each box, raw resources left out: they count once for the
  // whole plan, so where they cross makes no difference.
  const touching = new Map(boxes.map((b) => [b, [] as FlowEdge[]]));
  for (const e of graph.edges) {
    if (raw.has(e.item)) continue;
    if (boxSet.has(e.source)) touching.get(e.source)!.push(e);
    if (boxSet.has(e.target) && e.target !== e.source) touching.get(e.target)!.push(e);
  }
  /** Distinct parts crossing the border of `members`, coming in plus going out. */
  const border = (members: readonly string[]) => {
    const inside = new Set(members);
    const ins = new Set<string>();
    const outs = new Set<string>();
    for (const b of members)
      for (const e of touching.get(b)!) {
        const s = inside.has(e.source);
        const t = inside.has(e.target);
        if (s && !t) outs.add(e.item);
        else if (t && !s) ins.add(e.item);
      }
    return ins.size + outs.size;
  };
  const members = () => {
    const m = new Map<number, string[]>();
    for (const b of boxes) {
      const a = at.get(b)!;
      m.set(a, [...(m.get(a) ?? []), b]);
    }
    return m;
  };
  /** Areas joined to `a` by lines, most lines first. */
  const links = (list: readonly string[]) => {
    const own = at.get(list[0]!)!;
    const n = new Map<number, number>();
    for (const b of list)
      for (const y of [...succ.get(b)!, ...pred.get(b)!]) {
        const x = at.get(y)!;
        if (x !== own) n.set(x, (n.get(x) ?? 0) + 1);
      }
    return [...n].sort(([p, c], [q, d]) => d - c || p - q);
  };
  const move = (from: number, to: number) => {
    for (const [b, x] of at) if (x === from) at.set(b, to);
  };

  // Areas below PINCH_MIN join a neighbour: the one whose merge takes the
  // most parts off the borders, within PINCH_MAX when one has room. Modules
  // of PINCH_MIN or more keep their own area.
  for (;;) {
    const m = members();
    const small = [...m].filter(([, list]) => list.length < PINCH_MIN).sort(([p], [q]) => p - q);
    let done = true;
    for (const [a, list] of small) {
      const near = links(list);
      if (!near.length) continue;
      const own = border(list);
      const score = near.map(([b, lines]) => {
        const there = m.get(b)!;
        return {
          b,
          lines,
          fits: there.length + list.length <= PINCH_MAX,
          gain: own + border(there) - border([...there, ...list]),
        };
      });
      score.sort(
        (x, y) =>
          Number(y.fits) - Number(x.fits) || y.gain - x.gain || y.lines - x.lines || x.b - y.b,
      );
      move(a, score[0]!.b);
      done = false;
      break;
    }
    if (done) break;
  }
  // Single boxes move to a neighbouring area while that takes parts off the borders.
  for (let round = 0; round < 3; round++) {
    let moved = false;
    for (const b of boxes) {
      const m = members();
      const from = at.get(b)!;
      const home = m.get(from)!;
      if (home.length <= PINCH_MIN) continue;
      const without = home.filter((x) => x !== b);
      const near = new Set<number>();
      for (const y of [...succ.get(b)!, ...pred.get(b)!]) {
        const a = at.get(y)!;
        if (a !== from && m.get(a)!.length < PINCH_MAX) near.add(a);
      }
      for (const a of [...near].sort((p, q) => p - q)) {
        const there = m.get(a)!;
        const before = border(home) + border(there);
        if (border(without) + border([...there, b]) < before) {
          at.set(b, a);
          moved = true;
          break;
        }
      }
    }
    if (!moved) break;
  }

  // Ids and names from what each area sends out; areas in production order.
  const groups = members();
  const flows = areaFlows(graph.edges, new Map([...at].map(([b, a]) => [b, String(a)])), boxSet);
  const node = new Map(graph.nodes.map((n) => [n.id, n]));
  /** One step from the ground: a resource, or a box fed only raw resources. */
  const basic = (b: string) => node.get(b)!.inputs.every((i) => raw.has(i.item));
  /**
   * What an area sends out, its main products first: targets, then parts
   * other boxes use, those with the most of the area's boxes behind them
   * first, then the largest rate.
   */
  const sent = (a: number) => {
    const inside = new Set(groups.get(a)!);
    const behind = (b: string) => {
      const seen = new Set([b]);
      for (const stack = [b]; stack.length;)
        for (const p of pred.get(stack.pop()!)!)
          if (inside.has(p) && !seen.has(p)) {
            seen.add(p);
            stack.push(p);
          }
      return seen.size;
    };
    const out = new Map<
      string,
      { name: string; rate: number; depth: number; basic: boolean; rank: number }
    >();
    for (const e of graph.edges) {
      if (!inside.has(e.source) || inside.has(e.target)) continue;
      if (!flows.get(String(a))?.outs.has(e.item)) continue;
      const r = out.get(e.item);
      // Targets name an area first, then parts other boxes use; raw
      // resources and what only goes to a byproduct dump come last.
      const to = node.get(e.target)?.kind;
      const rank = to === 'target' ? 0 : raw.has(e.item) ? 2 : to === 'byproduct' ? 3 : 1;
      out.set(e.item, {
        name: e.itemName,
        rate: (r?.rate ?? 0) + e.rate,
        depth: Math.max(r?.depth ?? 0, behind(e.source)),
        basic: (r?.basic ?? true) && basic(e.source),
        rank: Math.min(r?.rank ?? 3, rank),
      });
    }
    return [...out].sort(
      ([i, x], [j, y]) => x.rank - y.rank || y.depth - x.depth || y.rate - x.rate || cmp(i, j),
    );
  };
  // Production order: an area comes after every area that feeds it, loops
  // broken at the area with the earliest box.
  const feeds = new Map<number, Set<number>>([...groups.keys()].map((a) => [a, new Set()]));
  for (const e of graph.edges) {
    const x = at.get(e.source);
    const y = at.get(e.target);
    if (x !== undefined && y !== undefined && x !== y) feeds.get(y)!.add(x);
  }
  const first = (a: number) => Math.min(...groups.get(a)!.map((b) => index.get(b)!));
  const placed: number[] = [];
  const left = new Set(groups.keys());
  while (left.size) {
    const ready = [...left].filter((a) => [...feeds.get(a)!].every((x) => !left.has(x)));
    const pick = (ready.length ? ready : [...left]).sort((p, q) => first(p) - first(q))[0]!;
    placed.push(pick);
    left.delete(pick);
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  const areas: PinchArea[] = [];
  const named = new Map<number, string>();
  for (const a of placed) {
    const out = sent(a);
    const inside = groups.get(a)!;
    const base =
      PINCH_PREFIX +
      (out.length
        ? out
            .map(([i]) => i)
            .sort(cmp)
            .join('+')
        : inside[0]!);
    let id = base;
    for (let k = 2; ids.has(id); k++) id = `${base}~${k}`;
    ids.add(id);
    named.set(a, id);
    const parts = out.map(([, x]) => x.name);
    const ground = out.length > 0 && out.filter(([, x]) => x.basic).length * 2 >= out.length;
    const label = ground
      ? 'Ore Processing'
      : parts.length === 0
        ? (node.get(inside[0]!)?.label ?? 'Area')
        : parts.length === 1
          ? parts[0]!
          : parts.length === 2
            ? `${parts[0]} & ${parts[1]}`
            : `${parts[0]} +${parts.length - 1}`;
    let name = label;
    for (let k = 2; names.has(name); k++) name = `${label} ${k}`;
    names.add(name);
    areas.push({ id, name });
  }
  return { at: new Map([...at].map(([b, a]) => [b, named.get(a)!])), areas };
}
