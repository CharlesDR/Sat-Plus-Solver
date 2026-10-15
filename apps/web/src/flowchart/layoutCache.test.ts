import type { FactoryGraph, FactoryLayout } from '@sps/graph';
import { describe, expect, test } from 'vitest';
import { cachedLayout, hashText, layoutKey } from './layoutCache';

const graph = (n: number) => ({ nodes: [{ id: `r${n}` }], edges: [] }) as unknown as FactoryGraph;
const layout = (w: number): FactoryLayout => ({
  width: w,
  height: 1,
  nodes: [],
  edges: [],
  bundles: [],
});

describe('layout cache (S3)', () => {
  test('keys follow the graph and the number format', () => {
    expect(layoutKey(graph(1), 'a')).toBe(layoutKey(graph(1), 'a'));
    expect(layoutKey(graph(1), 'a')).not.toBe(layoutKey(graph(2), 'a'));
    expect(layoutKey(graph(1), 'a')).not.toBe(layoutKey(graph(1), 'b'));
    expect(hashText('x')).not.toBe(hashText('y'));
  });

  test('a key seen before gives its layout without laying out again (no storage here)', async () => {
    let runs = 0;
    const compute = () => Promise.resolve(layout(++runs));
    const key = layoutKey(graph(3), 'f');
    const first = await cachedLayout(key, compute);
    const again = await cachedLayout(key, compute);
    expect(runs).toBe(1);
    expect(again).toBe(first);
    await cachedLayout(layoutKey(graph(4), 'f'), compute);
    expect(runs).toBe(2);
  });
});
