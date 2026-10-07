import { describe, expect, test } from 'vitest';
import type { FactoryLayout, PlacedEdge, PlacedNode } from './layout';
import { gap, layoutScore } from './score';

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
    };
    expect(layoutScore(layout)).toEqual({
      crossings: 1,
      bends: 2,
      edgeLength: 110 + 60 + 80 + 50,
      area: 20_000,
      // The Z label sits 20 px left of node b and 2 px below its top: hypot(20, 2).
      minGap: 20.1,
    });
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
    };
    expect(layoutScore(layout).crossings).toBe(0);
  });

  test('gap is the distance between box edges, 0 when they touch', () => {
    const box = (x: number, y: number) => ({ x, y, width: 10, height: 10 });
    expect(gap(box(0, 0), box(13, 0))).toBe(3);
    expect(gap(box(0, 0), box(13, 14))).toBe(5);
    expect(gap(box(0, 0), box(5, 5))).toBe(0);
  });
});
