/**
 * Product lines (A107, DF-11): the sections after the ore band, side by side
 * with little trade between them.
 *
 * Each box goes with the product its output ends up in. With two or more
 * targets that is a target; with one, it is an ingredient of the final
 * assembly (the boxes making the target). A box sending less than
 * `LINE_SHARE` of its main product to one line, or none to any, goes in
 * Shared Parts, which feeds the lines from before them. Lines under
 * `PINCH_MIN` boxes join Shared Parts, and a section over `PINCH_MAX` boxes
 * splits at its own pinch points (A87). A plan with fewer than two lines has
 * nothing to stack, so it keeps pinch-point areas.
 *
 * Lines rank in a column by id, with Shared Parts, Final Assembly and the
 * band in the middle; ranks are only a preference (soft model order).
 */
import type { FactoryGraph, FlowEdge } from './factory';
import { PINCH_MAX, PINCH_MIN, PINCH_PREFIX, isBox, pinchAreas, type PinchArea } from './pinch';

/** A box joins a line when at least this share of its main product ends up there. */
export const LINE_SHARE = 0.75;

/** Passes of the share propagation; loops in a plan settle well within it. */
const PASSES = 30;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const SHARED = `${PINCH_PREFIX}lines:shared`;
const FINAL = `${PINCH_PREFIX}lines:final`;
/** A line's id: pinch-point ids hold one colon, so these never meet one. */
const lineId = (item: string) => `${PINCH_PREFIX}line:${item}`;

export interface ProductLines {
  at: Map<string, string>;
  areas: PinchArea[];
  /** Vertical rank of each area. */
  rank: Map<string, number>;
  /** The rank of the middle of the column, for areas outside the lines. */
  middle: number;
}

/**
 * The plan's product lines over its boxes not in `apart` (the band and fresh
 * fluid extraction), or `undefined` when it has fewer than two.
 */
export function productLines(
  graph: FactoryGraph,
  apart: ReadonlySet<string>,
): ProductLines | undefined {
  const node = new Map(graph.nodes.map((n) => [n.id, n]));
  const mid = graph.nodes.filter((n) => isBox(n) && !apart.has(n.id)).map((n) => n.id);
  const inMid = new Set(mid);
  const targets = graph.nodes.filter((n) => n.kind === 'target');
  const single = new Set(targets.map((n) => n.item ?? n.id)).size < 2;
  const isTarget = new Set(targets.map((n) => n.id));
  const finals = new Set(
    graph.edges.filter((e) => isTarget.has(e.target) && inMid.has(e.source)).map((e) => e.source),
  );
  // The line an edge ends a line in, if it does.
  const ends = (e: FlowEdge): string | undefined => {
    if (isTarget.has(e.target)) return single ? undefined : e.item;
    return single && finals.has(e.target) && !finals.has(e.source) ? e.item : undefined;
  };
  const outs = new Map<string, FlowEdge[]>();
  for (const e of graph.edges) {
    if (!inMid.has(e.source)) continue;
    const list = outs.get(e.source);
    if (list) list.push(e);
    else outs.set(e.source, [e]);
  }
  // Share of each box's main product ending up in each line, from the targets back.
  const share = new Map<string, Map<string, number>>();
  const order = [...mid].reverse();
  for (let pass = 0; pass < PASSES; pass++)
    for (const b of order) {
      if (single && finals.has(b)) continue;
      const all = outs.get(b) ?? [];
      const main = all.filter((e) => e.item === node.get(b)!.main);
      const used = (main.length ? main : all).filter(
        (e) => inMid.has(e.target) || isTarget.has(e.target),
      );
      const total = used.reduce((t, e) => t + e.rate, 0);
      const s = new Map<string, number>();
      if (total > 0)
        for (const e of used) {
          const f = e.rate / total;
          const line = ends(e);
          if (line !== undefined) s.set(line, (s.get(line) ?? 0) + f);
          else for (const [k, v] of share.get(e.target) ?? []) s.set(k, (s.get(k) ?? 0) + f * v);
        }
      share.set(b, s);
    }
  const section = new Map<string, string>();
  for (const b of mid) {
    if (single && finals.has(b)) {
      section.set(b, FINAL);
      continue;
    }
    const best = [...(share.get(b) ?? [])].sort(([a, x], [c, y]) => y - x || cmp(a, c))[0];
    section.set(b, best !== undefined && best[1] >= LINE_SHARE ? lineId(best[0]) : SHARED);
  }
  const size = new Map<string, number>();
  for (const v of section.values()) size.set(v, (size.get(v) ?? 0) + 1);
  for (const [b, v] of section)
    if (v !== SHARED && v !== FINAL && size.get(v)! < PINCH_MIN) section.set(b, SHARED);
  const place = (k: string) => (k === SHARED ? 0 : k === FINAL ? 2 : 1);
  const sections = [...new Set(section.values())].sort((a, b) => place(a) - place(b) || cmp(a, b));
  const lines = sections.filter((k) => place(k) === 1);
  if (lines.length < 2) return undefined;

  const itemName = new Map(graph.edges.map((e) => [e.item, e.itemName]));
  const title = (k: string) => {
    if (k === SHARED) return 'Shared Parts';
    if (k === FINAL) return 'Final Assembly';
    const item = k.slice(lineId('').length);
    return itemName.get(item) ?? item;
  };
  const middle = (lines.length - 1) / 2;
  const at = new Map<string, string>();
  const areas: PinchArea[] = [];
  const rank = new Map<string, number>();
  for (const k of sections) {
    const inside = mid.filter((b) => section.get(b) === k);
    const r = place(k) === 1 ? lines.indexOf(k) : middle;
    if (inside.length <= PINCH_MAX) {
      for (const b of inside) at.set(b, k);
      areas.push({ id: k, name: title(k) });
      rank.set(k, r);
      continue;
    }
    const mine = new Set(inside);
    const p = pinchAreas(graph, new Set([...apart, ...mid.filter((b) => !mine.has(b))]));
    for (const a of p.areas) {
      areas.push({ id: `${k}/${a.id}`, name: a.name });
      rank.set(`${k}/${a.id}`, r);
    }
    for (const [b, a] of p.at) if (mine.has(b)) at.set(b, `${k}/${a}`);
  }
  const seen = new Set<string>();
  for (const a of areas) {
    const base = a.name;
    for (let k = 2; seen.has(a.name); k++) a.name = `${base} ${k}`;
    seen.add(a.name);
  }
  const used = new Set(at.values());
  return { at, areas: areas.filter((a) => used.has(a.id)), rank, middle };
}
