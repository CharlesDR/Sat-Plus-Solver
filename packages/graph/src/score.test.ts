import { describe, expect, test } from 'vitest';
import type { FactoryLayout, PlacedEdge, PlacedNode } from './layout';
import { COST_WEIGHTS, gap, layoutScore } from './score';

const node = (id: string, x: number, y: number): PlacedNode =>
  ({ id, x, y, width: 40, height: 20 }) as PlacedNode;
const edge = (id: string, points: [number, number][], label: [number, number]): PlacedEdge =>
  ({
    id,
    points: points.map(([x, y]) => ({ x, y })),
    label: { x: label[0], y: label[1], width: 10, height: 10, text: '' },
  }) as PlacedEdge;

describe('layoutScore (A43)', () => {
  test('counts crossings, bends, length, area and the smallest gap', () => {
    const layout: FactoryLayout = {
      width: 200,
      height: 100,
      nodes: [node('a', 0, 0), node('b', 150, 70)],
      edges: [
        // A horizontal edge, and a Z-shaped one whose middle leg crosses it.
        edge(
          'h',
          [
            [40, 50],
            [150, 50],
          ],
          [60, 30],
        ),
        edge(
          'z',
          [
            [40, 10],
            [100, 10],
            [100, 90],
            [150, 90],
          ],
          [120, 92],
        ),
      ],
      bundles: [],
    };
    expect(layoutScore(layout)).toEqual({
      crossings: 1,
      bends: 2,
      edgeLength: 110 + 60 + 80 + 50,
      area: 20_000,
      // The Z label sits 20 px left of node b and 2 px below its top: hypot(20, 2).
      minGap: 20.1,
      backEdges: 0,
      // 10 per crossing, 1 per bend, 0.001 per px (A88).
      cost: 10 + 2 + 0.3,
    });
  });

  test('counts stretches heading back, right to left, in the blended cost (A88)', () => {
    const layout: FactoryLayout = {
      width: 200,
      height: 100,
      nodes: [],
      edges: [
        // Out right, down, back left past where it started, down, and right again.
        edge(
          'loop',
          [
            [100, 10],
            [120, 10],
            [120, 50],
            [20, 50],
            [20, 90],
            [60, 90],
          ],
          [150, 0],
        ),
        // A 2 px jog to meet a port is not a line going back.
        edge(
          'jog',
          [
            [150, 20],
            [148, 20],
          ],
          [180, 0],
        ),
      ],
      bundles: [],
    };
    const s = layoutScore(layout);
    expect(s.backEdges).toBe(1);
    expect(s.bends).toBe(4);
    // 4 for the line heading back, 1 per bend, 242 px of line, rounded to 0.1.
    expect(s.cost).toBe(4 + 4 + 0.2);
    expect(COST_WEIGHTS.backEdges).toBeLessThan(COST_WEIGHTS.crossings);
    expect(COST_WEIGHTS.bends).toBeLessThan(COST_WEIGHTS.backEdges);
  });

  test('edges that only meet at a shared end do not cross', () => {
    const layout: FactoryLayout = {
      width: 100,
      height: 100,
      nodes: [],
      edges: [
        edge(
          'a',
          [
            [0, 50],
            [50, 50],
          ],
          [0, 0],
        ),
        edge(
          'b',
          [
            [50, 50],
            [50, 100],
          ],
          [80, 80],
        ),
      ],
      bundles: [],
    };
    expect(layoutScore(layout).crossings).toBe(0);
  });

  test('a stretch two lines share is drawn, and counted, once (A46)', () => {
    // Two branches of one bundle: a shared trunk to (50, 50), then one goes
    // up and one down. A vertical line crosses the trunk.
    const branch = (id: string, y: number) =>
      edge(
        id,
        [
          [0, 50],
          [50, 50],
          [50, y],
          [100, y],
        ],
        [0, 0],
      );
    const layout: FactoryLayout = {
      width: 100,
      height: 100,
      nodes: [],
      edges: [
        branch('up', 0),
        branch('down', 100),
        edge(
          'v',
          [
            [25, 0],
            [25, 100],
          ],
          [80, 80],
        ),
      ],
      bundles: [],
    };
    const s = layoutScore(layout);
    expect(s.crossings).toBe(1);
    // The trunk once, each branch's two legs, and the vertical line.
    expect(s.edgeLength).toBe(50 + 2 * (50 + 50) + 100);
    // Each branch turns twice; the trunk's end is a different corner for each.
    expect(s.bends).toBe(4);
  });

  test('gap is the distance between box edges, 0 when they touch', () => {
    const box = (x: number, y: number) => ({ x, y, width: 10, height: 10 });
    expect(gap(box(0, 0), box(13, 0))).toBe(3);
    expect(gap(box(0, 0), box(13, 14))).toBe(5);
    expect(gap(box(0, 0), box(5, 5))).toBe(0);
  });
});
