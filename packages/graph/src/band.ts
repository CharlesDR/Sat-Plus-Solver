/**
 * The ore band (A107, DF-11): the plan's ore processing, grouped apart at the
 * left of a flowchart drawn in pinch-point areas (A87).
 *
 * The band starts at mined solids. A recipe fed by the band joins it while it
 * makes an Ore Processing item (crushed, washed, sorted ore; not Water, Air
 * or Steam), and the band ends at the step making an ingot or billet. Molten
 * metal never leaves the band: every box that makes molten metal or uses it
 * is in it, with the part it casts (Steel Rod from Molten Steel).
 *
 * Up to `PINCH_MAX` boxes the band is one area, Ore Processing. A bigger band
 * splits into metal lanes, one per ingot or cast part, when less than
 * `LANE_TRADE_MAX` of its flow moves between lanes; otherwise into
 * Extraction and Smelting, when each holds `PINCH_MIN` boxes or more.
 * Steps are told apart by product name (Ingot, Billet, Molten), so a mod
 * update renaming these needs this module checked.
 */
import type { FactoryGraph, FlowEdge, FlowNode } from './factory';
import { PINCH_MAX, PINCH_MIN, PINCH_PREFIX, type PinchArea } from './pinch';

/**
 * Prefix of the band's area ids. Pinch-point ids hold one colon (`pp:` and
 * item ids, which have none), so these never meet one.
 */
export const BAND_PREFIX = `${PINCH_PREFIX}band:`;

/** True for an area id of the ore band. */
export const isBandArea = (area: string | undefined) => area?.startsWith(BAND_PREFIX) ?? false;

/** Metal lanes only while less than this share of the band's flow moves between them. */
export const LANE_TRADE_MAX = 0.1;

const INGOT = /\b(Ingot|Billet)$/;
const MOLTEN = /^Molten /;
/** Smelting-stage products: ingots, billets and molten metal. */
const SMELTED = /(^Molten |\bIngot$|\bBillet$)/;
/** Ore Processing items that are utilities, not ore. */
const UTILITY = new Set(['Water', 'Air', 'Steam']);

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** An item's name as the plan's lines carry it, or its id. */
const names = (graph: FactoryGraph) => {
  const name = new Map(graph.edges.map((e) => [e.item, e.itemName]));
  return (item: string) => name.get(item) ?? item;
};

/**
 * The band's boxes, each with whether it ends the band (an ingot, billet or
 * cast part). `isRaw` is true for Ore Processing items; `isFluid` for liquids
 * and gases, whose extraction is not ore processing.
 */
export function oreBand(
  graph: FactoryGraph,
  isRaw: (item: string) => boolean,
  isFluid: (item: string) => boolean,
): Map<string, boolean> {
  const name = names(graph);
  const into = new Map<string, FlowEdge[]>();
  for (const e of graph.edges) {
    const list = into.get(e.target);
    if (list) list.push(e);
    else into.set(e.target, [e]);
  }
  const band = new Map<string, boolean>();
  for (const n of graph.nodes)
    if (n.kind === 'resource' && n.main !== undefined && !isFluid(n.main)) band.set(n.id, false);
  for (let changed = true; changed;) {
    changed = false;
    for (const n of graph.nodes) {
      if (n.kind !== 'recipe' || n.main === undefined || band.has(n.id)) continue;
      const main = name(n.main);
      const edges = into.get(n.id) ?? [];
      const makesMolten = MOLTEN.test(main);
      if (makesMolten || edges.some((e) => MOLTEN.test(e.itemName))) {
        band.set(n.id, !makesMolten);
        changed = true;
        continue;
      }
      if (!edges.some((e) => band.get(e.source) === false)) continue;
      const ingot = INGOT.test(main);
      if (!ingot && !(isRaw(n.main) && !UTILITY.has(main))) continue;
      band.set(n.id, ingot);
      changed = true;
    }
  }
  return band;
}

/** The band's areas, and each band box's area. */
export function bandAreas(
  graph: FactoryGraph,
  band: ReadonlyMap<string, boolean>,
): { at: Map<string, string>; areas: PinchArea[] } {
  const name = names(graph);
  const boxes = graph.nodes.filter((n) => band.has(n.id));
  const at = new Map<string, string>();
  if (!boxes.length) return { at, areas: [] };
  const one = () => {
    const id = `${BAND_PREFIX}ore`;
    for (const n of boxes) at.set(n.id, id);
    return { at, areas: [{ id, name: 'Ore Processing' }] };
  };
  if (boxes.length <= PINCH_MAX) return one();
  const lanes = metalLanes(graph, boxes, band);
  if (lanes) {
    const areas: PinchArea[] = [];
    const ids = new Set<string>();
    for (const [key, list] of [...lanes].sort(([a], [b]) => cmp(a, b))) {
      const base = `${BAND_PREFIX}${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      let id = base;
      for (let k = 2; ids.has(id); k++) id = `${base}~${k}`;
      ids.add(id);
      for (const n of list) at.set(n.id, id);
      const ends = [
        ...new Set(list.filter((n) => band.get(n.id) === true).map((n) => name(n.main!))),
      ].sort(cmp);
      areas.push({
        id,
        name:
          ends.length > 2 ? `${ends[0]} & ${ends[1]} +${ends.length - 2}` : ends.join(' & ') || key,
      });
    }
    return { at, areas };
  }
  const smelted = (n: FlowNode) => band.get(n.id) === true || SMELTED.test(name(n.main!));
  const late = boxes.filter(smelted).length;
  if (late < PINCH_MIN || boxes.length - late < PINCH_MIN) return one();
  const early = `${BAND_PREFIX}extraction`;
  const later = `${BAND_PREFIX}smelting`;
  for (const n of boxes) at.set(n.id, smelted(n) ? later : early);
  return {
    at,
    areas: [
      { id: early, name: 'Extraction' },
      { id: later, name: 'Smelting' },
    ],
  };
}

/**
 * Metal lanes: each band-ending box starts the lane of its product, and an
 * earlier box joins the lane taking most of its main product. Lanes under
 * `PINCH_MIN` boxes join the lane they trade most with. `undefined` when
 * there are fewer than two lanes or they trade too much.
 */
function metalLanes(
  graph: FactoryGraph,
  boxes: readonly FlowNode[],
  band: ReadonlyMap<string, boolean>,
): Map<string, FlowNode[]> | undefined {
  const name = names(graph);
  const lane = new Map<string, string>();
  for (const n of boxes) if (band.get(n.id) === true) lane.set(n.id, name(n.main!));
  for (let changed = true; changed;) {
    changed = false;
    for (const n of boxes) {
      if (lane.has(n.id)) continue;
      const take = new Map<string, number>();
      for (const e of graph.edges) {
        const l = e.source === n.id && e.item === n.main ? lane.get(e.target) : undefined;
        if (l !== undefined && band.has(e.target)) take.set(l, (take.get(l) ?? 0) + e.rate);
      }
      if (!take.size) continue;
      lane.set(n.id, [...take].sort(([a, x], [b, y]) => y - x || cmp(a, b))[0]![0]);
      changed = true;
    }
  }
  const lanes = new Map<string, FlowNode[]>();
  for (const n of boxes) {
    const k = lane.get(n.id) ?? 'Other';
    const list = lanes.get(k);
    if (list) list.push(n);
    else lanes.set(k, [n]);
  }
  const trade = (a: readonly FlowNode[], b: readonly FlowNode[]) => {
    const x = new Set(a.map((n) => n.id));
    const y = new Set(b.map((n) => n.id));
    let rate = 0;
    for (const e of graph.edges)
      if ((x.has(e.source) && y.has(e.target)) || (y.has(e.source) && x.has(e.target)))
        rate += e.rate;
    return rate;
  };
  for (;;) {
    const small = [...lanes].filter(([, l]) => l.length < PINCH_MIN).sort(([a], [b]) => cmp(a, b));
    if (!small.length || lanes.size < 2) break;
    const [key, list] = small[0]!;
    const others = [...lanes.keys()].filter((o) => o !== key);
    const score = (o: string) => trade(list, lanes.get(o)!);
    const best = others.reduce((b, o) =>
      score(o) > score(b) || (score(o) === score(b) && lanes.get(o)!.length > lanes.get(b)!.length)
        ? o
        : b,
    );
    lanes.get(best)!.push(...list);
    lanes.delete(key);
  }
  if (lanes.size < 2) return undefined;
  const laneOf = new Map<string, string>();
  for (const [k, list] of lanes) for (const n of list) laneOf.set(n.id, k);
  let inside = 0;
  let across = 0;
  for (const e of graph.edges) {
    const a = laneOf.get(e.source);
    const b = laneOf.get(e.target);
    if (a === undefined || b === undefined) continue;
    if (a === b) inside += e.rate;
    else across += e.rate;
  }
  return across <= LANE_TRADE_MAX * (inside + across) ? lanes : undefined;
}

/** The metal an ingot, billet or molten metal line carries. */
const metalOf = (e: FlowEdge) =>
  INGOT.test(e.itemName) || MOLTEN.test(e.itemName)
    ? e.itemName.replace(/^Molten | Ingot$| Billet$/g, '')
    : undefined;

/**
 * Vertical order of areas without product lines (A107): each area's rank
 * from the metals it takes straight from the band, with the metals in a line
 * so the most used is first and each next is the one most used with it.
 * Band lanes rank by the metals they make; an area taking none sits with the
 * areas feeding it. Ranks are only a preference (soft model order).
 */
export function metalRanks(
  graph: FactoryGraph,
  at: ReadonlyMap<string, string>,
  areas: readonly { id: string }[],
): Map<string, number> {
  const direct = new Map<string, Set<string>>();
  const feeds = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    const s = m.get(k);
    if (s) s.add(v);
    else m.set(k, new Set([v]));
  };
  for (const e of graph.edges) {
    const a = at.get(e.source);
    const b = at.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const metal = metalOf(e);
    if (isBandArea(a) && metal !== undefined) add(direct, b, metal);
    else if (!isBandArea(a) && !isBandArea(b)) add(feeds, b, a);
  }
  const count = new Map<string, number>();
  const together = new Map<string, number>();
  const pair = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  for (const s of direct.values()) {
    const v = [...s].sort(cmp);
    for (const x of v) count.set(x, (count.get(x) ?? 0) + 1);
    for (const x of v)
      for (const y of v) if (x < y) together.set(pair(x, y), (together.get(pair(x, y)) ?? 0) + 1);
  }
  const left = [...count.keys()].sort((x, y) => count.get(y)! - count.get(x)! || cmp(x, y));
  const line: string[] = [];
  while (left.length) {
    const last = line.at(-1);
    const w = (o: string) => (last === undefined ? 0 : (together.get(pair(last, o)) ?? 0));
    const k = left.reduce((best, o, i) => (w(o) > w(left[best]!) ? i : best), 0);
    line.push(...left.splice(k, 1));
  }
  const pos = new Map(line.map((m, k) => [m, k]));
  const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const out = new Map<string, number>();
  for (const a of areas) {
    if (!isBandArea(a.id)) continue;
    const made = graph.edges
      .filter((e) => at.get(e.source) === a.id && at.get(e.target) !== a.id)
      .map((e) => pos.get(metalOf(e) ?? ''))
      .filter((x): x is number => x !== undefined);
    if (made.length) out.set(a.id, mean(made));
  }
  for (const a of areas) {
    if (isBandArea(a.id)) continue;
    const d = [...(direct.get(a.id) ?? [])].map((m) => pos.get(m)!);
    if (d.length) out.set(a.id, mean(d));
  }
  for (const a of areas) {
    if (isBandArea(a.id) || out.has(a.id)) continue;
    const f = [...(feeds.get(a.id) ?? [])]
      .map((x) => out.get(x))
      .filter((x): x is number => x !== undefined);
    if (f.length) out.set(a.id, mean(f));
  }
  return out;
}
