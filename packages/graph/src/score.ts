/**
 * Layout quality score (A43): numbers that say whether a flowchart change made
 * the layout better, so "tighter but not crowded" can be checked. Lower is
 * better for everything except `minGap`, which must stay above a floor.
 */
import type { Box, FactoryLayout } from './layout';

export interface LayoutScore {
  /** Places where two edges cross (a horizontal and a vertical segment). */
  crossings: number;
  /** Corners along all edges, each drawn corner once. */
  bends: number;
  /** Total routed edge length, px, each drawn segment once. */
  edgeLength: number;
  /** Width × height of the whole drawing, px². */
  area: number;
  /** Smallest gap between two boxes (nodes and edge labels), px. */
  minGap: number;
  /** Stretches of line heading right to left, against the flow (A88). */
  backEdges: number;
  /** The blended cost layouts are compared by (A88): see `layoutCost`. */
  cost: number;
}

/**
 * Weights of the blended layout cost (A88, Charles 2026-10-14): a crossing
 * costs most, a line heading back less, an elbow least; length breaks ties.
 */
export const COST_WEIGHTS = { crossings: 10, backEdges: 4, bends: 1, edgeLength: 0.001 };

/** The blended cost of a score: lower is an easier chart to follow. */
export function layoutCost(
  s: Pick<LayoutScore, 'crossings' | 'backEdges' | 'bends' | 'edgeLength'>,
) {
  const w = COST_WEIGHTS;
  return (
    Math.round(
      (w.crossings * s.crossings +
        w.backEdges * s.backEdges +
        w.bends * s.bends +
        w.edgeLength * s.edgeLength) *
        10,
    ) / 10
  );
}

type Segment = { x1: number; y1: number; x2: number; y2: number };

/** Strictly inside an interval, so edges meeting at a shared end don't count. */
const inside = (v: number, a: number, b: number) =>
  v > Math.min(a, b) + 0.5 && v < Math.max(a, b) - 0.5;

function crosses(h: Segment, v: Segment): boolean {
  return inside(v.x1, h.x1, h.x2) && inside(h.y1, v.y1, v.y2);
}

const isHorizontal = (s: Segment) => Math.abs(s.y1 - s.y2) < 1e-6;
const isVertical = (s: Segment) => Math.abs(s.x1 - s.x2) < 1e-6;

/** Distance between two boxes; 0 when they touch or overlap. */
export function gap(a: Box, b: Box): number {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A line drawn once counts once: lines that share a stretch (a fan-out
 * leaving its box, A93) share its segments and corners.
 */
export function layoutScore(layout: FactoryLayout): LayoutScore {
  const key = (...v: number[]) => v.map((n) => n.toFixed(3)).join(',');
  const seen = new Set<string>();
  const corners = new Set<string>();
  const segments = layout.edges.map((e) => {
    e.points.slice(1, -1).forEach((p, k) => {
      const a = e.points[k]!;
      const b = e.points[k + 2]!;
      corners.add(key(a.x, a.y, p.x, p.y, b.x, b.y));
    });
    return e.points.slice(1).flatMap((p, k): Segment[] => {
      const q = e.points[k]!;
      const id = key(q.x, q.y, p.x, p.y);
      if (seen.has(id)) return [];
      seen.add(id);
      return [{ x1: q.x, y1: q.y, x2: p.x, y2: p.y }];
    });
  });
  let crossings = 0;
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++)
      for (const a of segments[i]!)
        for (const b of segments[j]!) {
          if (isHorizontal(a) && isVertical(b) && crosses(a, b)) crossings++;
          else if (isVertical(a) && isHorizontal(b) && crosses(b, a)) crossings++;
        }
  const bends = corners.size;
  // Ignore stubs: a jog of a few px to meet a port is not a line going back.
  const backEdges = segments.flat().filter((g) => isHorizontal(g) && g.x1 - g.x2 > 2).length;
  const edgeLength = segments
    .flat()
    .reduce((s, g) => s + Math.abs(g.x2 - g.x1) + Math.abs(g.y2 - g.y1), 0);
  const boxes: Box[] = [...layout.nodes, ...layout.edges.map((e) => e.label)];
  let minGap = Infinity;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) minGap = Math.min(minGap, gap(boxes[i]!, boxes[j]!));
  const score = {
    crossings,
    bends,
    edgeLength: round1(edgeLength),
    area: round1(layout.width * layout.height),
    minGap: Number.isFinite(minGap) ? round1(minGap) : 0,
    backEdges,
  };
  return { ...score, cost: layoutCost(score) };
}
