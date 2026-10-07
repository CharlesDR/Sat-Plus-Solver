/**
 * Layout quality score (A43): numbers that say whether a flowchart change made
 * the layout better, so "tighter but not crowded" can be checked. Lower is
 * better for everything except `minGap`, which must stay above a floor.
 */
import type { Box, FactoryLayout } from './layout';

export interface LayoutScore {
  /** Places where two edges cross (a horizontal and a vertical segment). */
  crossings: number;
  /** Corners along all edges. */
  bends: number;
  /** Total routed edge length, px. */
  edgeLength: number;
  /** Width × height of the whole drawing, px². */
  area: number;
  /** Smallest gap between two boxes (nodes and edge labels), px. */
  minGap: number;
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

export function layoutScore(layout: FactoryLayout): LayoutScore {
  const segments = layout.edges.map((e) =>
    e.points.slice(1).map((p, k): Segment => {
      const q = e.points[k]!;
      return { x1: q.x, y1: q.y, x2: p.x, y2: p.y };
    }),
  );
  let crossings = 0;
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++)
      for (const a of segments[i]!)
        for (const b of segments[j]!) {
          if (isHorizontal(a) && isVertical(b) && crosses(a, b)) crossings++;
          else if (isVertical(a) && isHorizontal(b) && crosses(b, a)) crossings++;
        }
  const bends = layout.edges.reduce((s, e) => s + Math.max(0, e.points.length - 2), 0);
  const edgeLength = segments
    .flat()
    .reduce((s, g) => s + Math.abs(g.x2 - g.x1) + Math.abs(g.y2 - g.y1), 0);
  const boxes: Box[] = [...layout.nodes, ...layout.edges.map((e) => e.label)];
  let minGap = Infinity;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) minGap = Math.min(minGap, gap(boxes[i]!, boxes[j]!));
  return {
    crossings,
    bends,
    edgeLength: round1(edgeLength),
    area: round1(layout.width * layout.height),
    minGap: Number.isFinite(minGap) ? round1(minGap) : 0,
  };
}
