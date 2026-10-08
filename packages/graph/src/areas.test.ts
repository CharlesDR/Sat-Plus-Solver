import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import { AREA_MIN_NODES, areaNodeId, groupAreas, type AreaCatalog } from './areas';
import type { FactoryGraph, FlowEdge, FlowNode } from './factory';
import { AREA_TITLE, layoutFactoryGraph, overlaps } from './layout';

/**
 * Ore is imported and smelted into ingots in 8 smelters; 8 assemblers make
 * parts from ingots, and the last one makes the target, plates. The
 * smelters also leave slag over.
 */
const N = 8;
const recipe = (
  id: string,
  inputs: [string, number][],
  outputs: [string, number][],
  machines = 1,
): FlowNode => ({
  id: `recipe:${id}`,
  kind: 'recipe',
  label: id,
  recipe: id,
  machine: 'M',
  machines,
  power: 4 * machines,
  main: outputs[0]![0],
  inputs: inputs.map(([item, rate]) => ({ item, rate })),
  outputs: outputs.map(([item, rate]) => ({ item, rate })),
});
const edge = (source: string, target: string, item: string, rate: number): FlowEdge => ({
  id: `${source}→${target}:${item}`,
  source,
  target,
  item,
  itemName: item,
  rate,
});
const graph = (): FactoryGraph => {
  const nodes: FlowNode[] = [
    {
      id: 'import:ore',
      kind: 'import',
      label: 'Ore',
      item: 'ore',
      rate: 10 * N,
      inputs: [],
      outputs: [{ item: 'ore', rate: 10 * N }],
    },
  ];
  const edges: FlowEdge[] = [];
  for (let k = 0; k < N; k++) {
    nodes.push(
      recipe(
        `smelt-${k}`,
        [['ore', 10]],
        [
          ['ingot', 10],
          ['slag', 1],
        ],
      ),
    );
    edges.push(edge('import:ore', `recipe:smelt-${k}`, 'ore', 10));
  }
  for (let k = 0; k < N; k++) {
    const last = k === N - 1;
    nodes.push(
      recipe(
        `part-${k}`,
        [['ingot', 10], ...(k ? [[`part-${k - 1}`, 1] as [string, number]] : [])],
        [[last ? 'plate' : `part-${k}`, 1]],
        2,
      ),
    );
    edges.push(edge(`recipe:smelt-${k}`, `recipe:part-${k}`, 'ingot', 10));
    if (k) edges.push(edge(`recipe:part-${k - 1}`, `recipe:part-${k}`, `part-${k - 1}`, 1));
  }
  nodes.push({
    id: 'target:plate',
    kind: 'target',
    label: 'Plate',
    item: 'plate',
    rate: 1,
    inputs: [{ item: 'plate', rate: 1 }],
    outputs: [],
  });
  edges.push(edge(`recipe:part-${N - 1}`, 'target:plate', 'plate', 1));
  nodes.push({
    id: 'byproduct:slag',
    kind: 'byproduct',
    label: 'Slag',
    item: 'slag',
    rate: N,
    inputs: [{ item: 'slag', rate: N }],
    outputs: [],
  });
  for (let k = 0; k < N; k++) edges.push(edge(`recipe:smelt-${k}`, 'byproduct:slag', 'slag', 1));
  return { nodes, edges: edges.sort((a, b) => (a.id < b.id ? -1 : 1)) };
};
const catalog: AreaCatalog = {
  areas: [
    { id: 'ore', name: 'Ore Processing', rule: 'raw' },
    { id: 'parts', name: 'Parts' },
    { id: 'other', name: 'Other', rule: 'fallback' },
    { id: 'final', name: 'Final Assembly', rule: 'targets' },
  ],
  itemArea: (item) =>
    item === 'ore' || item === 'ingot' ? 'ore' : item === 'slag' ? undefined : 'parts',
};
const areaOf = (g: FactoryGraph, id: string) => g.nodes.find((n) => n.id === id)?.area;

describe('groupAreas (A57)', () => {
  test('places each node: recipes by main product, the target maker and target in Final Assembly, ends with their neighbours', () => {
    const g = groupAreas(graph(), catalog);
    expect(g.areas?.map((a) => a.id)).toEqual(['ore', 'parts', 'final']);
    expect(areaOf(g, 'recipe:smelt-0')).toBe('ore');
    expect(areaOf(g, 'recipe:part-0')).toBe('parts');
    expect(areaOf(g, `recipe:part-${N - 1}`)).toBe('final');
    expect(areaOf(g, 'target:plate')).toBe('final');
    expect(areaOf(g, 'import:ore')).toBe('ore');
    expect(areaOf(g, 'byproduct:slag')).toBe('ore');
    expect(g.areas?.find((a) => a.id === 'ore')).toMatchObject({ machines: N, power: 4 * N });
  });

  test('stays one flowchart when off, small, or all in one area', () => {
    const g = graph();
    expect(groupAreas(g, catalog, { off: true })).toBe(g);
    expect(groupAreas(g, undefined)).toBe(g);
    const small = { nodes: g.nodes.filter((n) => !n.id.startsWith('recipe:part')), edges: [] };
    expect(small.nodes.filter((n) => n.kind === 'recipe').length).toBeLessThan(AREA_MIN_NODES);
    expect(groupAreas(small, catalog)).toBe(small);
    const one = {
      areas: catalog.areas.filter((a) => a.rule !== 'targets'),
      itemArea: () => 'parts',
    };
    expect(groupAreas(g, one)).toBe(g);
  });

  test('applies the factory’s names and moves; an unknown area or node is ignored', () => {
    const g = groupAreas(graph(), catalog, {
      names: { parts: 'Gear Shop', ore: '  ' },
      moves: { 'recipe:part-0': 'ore', 'recipe:smelt-1': 'nope', 'recipe:gone': 'parts' },
    });
    expect(g.areas?.map((a) => a.name)).toEqual(['Ore Processing', 'Gear Shop', 'Final Assembly']);
    expect(areaOf(g, 'recipe:part-0')).toBe('ore');
    expect(areaOf(g, 'recipe:smelt-1')).toBe('ore');
  });

  test('a collapsed area is one box with what crosses its border', () => {
    const g = groupAreas(graph(), catalog, {}, new Set(['ore']));
    const box = g.nodes.find((n) => n.id === areaNodeId('ore'))!;
    expect(box).toMatchObject({ kind: 'area', label: 'Ore Processing', machines: N });
    expect(box.inputs).toEqual([]);
    expect(box.outputs).toEqual([{ item: 'ingot', rate: 10 * N }]);
    expect(g.nodes.some((n) => n.id === 'recipe:smelt-0' || n.id === 'import:ore')).toBe(false);
    // Eight ingot lines into eight parts makers stay apart; nothing inside is drawn.
    expect(g.edges.filter((e) => e.source === box.id)).toHaveLength(N);
    expect(g.edges.every((e) => e.source !== e.target)).toBe(true);
    expect(g.areas?.find((a) => a.id === 'ore')?.collapsed).toBe(true);
  });
});

describe('a grouped layout (A57)', () => {
  test('frames hold their own nodes and labels, nothing overlaps, lines are square, and it repeats', async () => {
    const g = groupAreas(graph(), catalog);
    const layout = await layoutFactoryGraph(g, new ELK(), { iconSize: 32, labelIconSize: 16 });
    expect(overlaps(layout)).toEqual([]);
    expect(layout.areas?.map((a) => a.id)).toEqual(['ore', 'parts', 'final']);
    const frame = new Map(layout.areas!.map((a) => [a.id, a]));
    for (const n of layout.nodes) {
      const f = frame.get(n.area!)!;
      expect(n.x).toBeGreaterThanOrEqual(f.x);
      expect(n.y).toBeGreaterThanOrEqual(f.y + AREA_TITLE);
      expect(n.x + n.width).toBeLessThanOrEqual(f.x + f.width);
      expect(n.y + n.height).toBeLessThanOrEqual(f.y + f.height);
      for (const other of layout.areas!)
        if (other.id !== n.area)
          expect(
            n.x < other.x + other.width &&
              other.x < n.x + n.width &&
              n.y < other.y + other.height &&
              other.y < n.y + n.height,
          ).toBe(false);
    }
    for (const e of layout.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      for (let k = 1; k < e.points.length; k++) {
        const a = e.points[k - 1]!;
        const b = e.points[k]!;
        expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true);
      }
      // Each line starts at its source's port and ends at its target's.
      const src = layout.nodes.find((n) => n.id === e.source)!;
      const dst = layout.nodes.find((n) => n.id === e.target)!;
      const out = src.ports.find((p) => p.dir === 'out' && p.item === e.item)!;
      const inn = dst.ports.find((p) => p.dir === 'in' && p.item === e.item)!;
      expect(e.points[0]).toEqual({ x: src.x + out.x, y: src.y + out.y });
      expect(e.points.at(-1)).toEqual({ x: dst.x + inn.x, y: dst.y + inn.y });
    }
    expect(
      await layoutFactoryGraph(JSON.parse(JSON.stringify(g)) as typeof g, new ELK(), {
        iconSize: 32,
        labelIconSize: 16,
      }),
    ).toEqual(layout);
  });

  test('a collapsed area is laid out as a box outside every frame', async () => {
    const g = groupAreas(graph(), catalog, {}, new Set(['ore']));
    const layout = await layoutFactoryGraph(g, new ELK());
    expect(layout.areas?.map((a) => a.id)).toEqual(['parts', 'final']);
    expect(layout.nodes.find((n) => n.id === areaNodeId('ore'))).toBeDefined();
    expect(overlaps(layout)).toEqual([]);
  });
});
