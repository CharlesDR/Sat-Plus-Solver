import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import type { FactoryGraph } from './factory';
import { layoutFactoryGraph, overlaps } from './layout';

const graph: FactoryGraph = {
  nodes: [
    {
      id: 'import:ore',
      kind: 'import',
      label: 'Ore',
      item: 'ore',
      rate: 60,
      inputs: [],
      outputs: [{ item: 'ore', rate: 60 }],
    },
    {
      id: 'recipe:ingot',
      kind: 'recipe',
      label: 'Ingot',
      recipe: 'ingot',
      machine: 'Smelter',
      machines: 2,
      machinesCeil: 2,
      inputs: [{ item: 'ore', rate: 60 }],
      outputs: [{ item: 'ingot', rate: 60 }],
    },
    {
      id: 'target:ingot',
      kind: 'target',
      label: 'Ingot',
      item: 'ingot',
      rate: 60,
      inputs: [{ item: 'ingot', rate: 60 }],
      outputs: [],
    },
  ],
  edges: [
    {
      id: 'import:ore→recipe:ingot:ore',
      source: 'import:ore',
      target: 'recipe:ingot',
      item: 'ore',
      itemName: 'Ore',
      rate: 60,
    },
    {
      id: 'recipe:ingot→target:ingot:ingot',
      source: 'recipe:ingot',
      target: 'target:ingot',
      item: 'ingot',
      itemName: 'Ingot',
      rate: 60,
    },
  ],
};

describe('layoutFactoryGraph', () => {
  test('left to right: import, recipe, target, with routed edges and labels', async () => {
    const l = await layoutFactoryGraph(graph, new ELK());
    const [imp, rec, tgt] = l.nodes;
    expect(imp!.x + imp!.width).toBeLessThan(rec!.x);
    expect(rec!.x + rec!.width).toBeLessThan(tgt!.x);
    for (const e of l.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      expect(e.label.text).toBe(`60 ${e.itemName}`);
      expect(e.label.width).toBeGreaterThan(0);
    }
    expect(overlaps(l)).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
  });

  test('deterministic: fresh engines give identical coordinates', async () => {
    const a = await layoutFactoryGraph(graph, new ELK());
    const b = await layoutFactoryGraph(
      JSON.parse(JSON.stringify(graph)) as FactoryGraph,
      new ELK(),
    );
    expect(b).toEqual(a);
  });

  test('custom edge labels size the label boxes', async () => {
    const l = await layoutFactoryGraph(graph, new ELK(), { edgeLabel: (e) => e.item });
    expect(l.edges.map((e) => e.label.text)).toEqual(['ore', 'ingot']);
  });

  test('overlaps reports intersecting nodes and labels', () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    const node = { ...graph.nodes[0]!, ...box };
    const found = overlaps({
      width: 20,
      height: 20,
      nodes: [node, { ...node, id: 'b', x: 5 }],
      edges: [{ ...graph.edges[0]!, points: [], label: { ...box, x: 50, text: 'x' } }],
    });
    expect(found).toEqual(['node import:ore × node b']);
  });
});
