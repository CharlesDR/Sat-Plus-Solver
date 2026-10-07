import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import type { FactoryGraph, FlowNode } from './factory';
import { ICON_GAP, layoutFactoryGraph, nodeText, overlaps, rateText, wrapText } from './layout';

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

const edge = (source: string, target: string, item: string, rate: number) => ({
  id: `${source}→${target}:${item}`,
  source,
  target,
  item,
  itemName: item,
  rate,
});

test('rateText: 1 to 4 decimals rounded up, commas between thousands (A41)', () => {
  expect(rateText(60)).toBe('60.0');
  expect(rateText(1555.5556)).toBe('1,555.5556');
  expect(rateText(-12345)).toBe('-12,345.0');
  expect(rateText(0.0004)).toBe('0.0004');
  expect(rateText(1 / 3)).toBe('0.3334');
  expect(rateText(60.00000001)).toBe('60.0');
});

describe('layoutFactoryGraph', () => {
  test('an icon widens every node by its size and gap, and sets a minimum height', async () => {
    const plain = await layoutFactoryGraph(graph, new ELK());
    const iconed = await layoutFactoryGraph(graph, new ELK(), { iconSize: 60 });
    for (const n of plain.nodes) {
      const m = iconed.nodes.find((x) => x.id === n.id)!;
      // The text area widens by the icon and its gap; the taller hexagon's
      // slanted sides reach further in (A40).
      expect(m.width - 2 * m.slant).toBe(n.width - 2 * n.slant + 60 + ICON_GAP);
      expect(m.height).toBeGreaterThanOrEqual(60);
    }
    expect(overlaps(iconed)).toEqual([]);
  });

  test('left to right: import, recipe, target, with routed edges and labels', async () => {
    const l = await layoutFactoryGraph(graph, new ELK());
    const [imp, rec, tgt] = l.nodes;
    expect(imp!.x + imp!.width).toBeLessThan(rec!.x);
    expect(rec!.x + rec!.width).toBeLessThan(tgt!.x);
    for (const e of l.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      expect(e.label.text).toBe(`60.0 ${e.itemName}`);
      expect(e.label.width).toBeGreaterThan(0);
    }
    expect(overlaps(l)).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
  });

  test('hexagons: edges meet the left vertex and leave the right one; byproducts get their own (A40)', async () => {
    const g: FactoryGraph = {
      nodes: (
        [
          ...graph.nodes,
          {
            id: 'byproduct:slag',
            kind: 'byproduct',
            label: 'Slag',
            item: 'slag',
            rate: 5,
            inputs: [{ item: 'slag', rate: 5 }],
            outputs: [],
          },
          {
            id: 'byproduct:gas',
            kind: 'byproduct',
            label: 'Gas',
            item: 'gas',
            rate: 2,
            inputs: [{ item: 'gas', rate: 2 }],
            outputs: [],
          },
        ] as FlowNode[]
      ).map((n): FlowNode =>
        n.id === 'recipe:ingot'
          ? {
              ...n,
              main: 'ingot',
              outputs: [
                { item: 'gas', rate: 2 },
                { item: 'ingot', rate: 60 },
                { item: 'slag', rate: 5 },
              ],
            }
          : n,
      ),
      edges: [
        ...graph.edges,
        edge('recipe:ingot', 'byproduct:gas', 'gas', 2),
        edge('recipe:ingot', 'byproduct:slag', 'slag', 5),
      ],
    };
    const l = await layoutFactoryGraph(g, new ELK());
    const node = (id: string) => l.nodes.find((n) => n.id === id)!;
    const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      expect(p.x).toBeCloseTo(q.x, 6);
      expect(p.y).toBeCloseTo(q.y, 6);
    };
    const port = Object.fromEntries(l.edges.map((e) => [e.item, e.sourcePort]));
    expect(port).toEqual({ ore: 'out', ingot: 'out', gas: 'by1', slag: 'by2' });
    for (const e of l.edges) {
      const s = node(e.source);
      const t = node(e.target);
      expect(s.slant).toBe(Math.round((s.height * Math.tan(Math.PI / 6)) / 2));
      const start = e.points[0]!;
      const end = e.points.at(-1)!;
      near(end, { x: t.x, y: t.y + t.height / 2 });
      if (e.sourcePort === 'out') near(start, { x: s.x + s.width, y: s.y + s.height / 2 });
      else
        near(start, {
          x: s.x + s.width - s.slant,
          y: e.sourcePort === 'by1' ? s.y + s.height : s.y,
        });
    }
    expect(overlaps(l)).toEqual([]);
  });

  test('deterministic: fresh engines give identical coordinates', async () => {
    const a = await layoutFactoryGraph(graph, new ELK());
    const b = await layoutFactoryGraph(
      JSON.parse(JSON.stringify(graph)) as FactoryGraph,
      new ELK(),
    );
    expect(b).toEqual(a);
  });

  test('long node text and edge labels wrap, and taller boxes fit them', async () => {
    const g = JSON.parse(JSON.stringify(graph)) as FactoryGraph;
    g.nodes[1]!.label = 'Siterite Ore (impure) → Iron Ingot with Water';
    g.nodes[1]!.machine = 'Flexible Blast Furnace';
    g.edges[1]!.itemName = 'Reinforced Iron Plate';
    const l = await layoutFactoryGraph(g, new ELK());
    const rec = l.nodes[1]!;
    expect(rec.text).toEqual({
      // 18 characters a line, so hexagons stay wide and short (A40).
      title: ['Siterite Ore', '(impure) → Iron', 'Ingot with Water'],
      details: ['2.0 × Flexible', 'Blast Furnace'],
    });
    expect(rec.height).toBeGreaterThan(l.nodes[0]!.height * 2);
    const label = l.edges[1]!.label;
    expect(label.text).toBe('60.0\nReinforced\nIron Plate');
    expect(label.height).toBeGreaterThan(l.edges[0]!.label.height * 2);
    expect(l.edges[0]!.label.text).toBe('60.0 Ore');
    expect(overlaps(l)).toEqual([]);
  });

  test('custom edge labels size the label boxes', async () => {
    const l = await layoutFactoryGraph(graph, new ELK(), { edgeLabel: (e) => e.item });
    expect(l.edges.map((e) => e.label.text)).toEqual(['ore', 'ingot']);
  });

  test('wrapText breaks between words; a long word keeps its own line', () => {
    expect(wrapText('Byproduct: Crushed Copper', 14)).toEqual(['Byproduct:', 'Crushed Copper']);
    expect(wrapText('a Supercalifragilistic b', 6)).toEqual(['a', 'Supercalifragilistic', 'b']);
    expect(wrapText('', 6)).toEqual(['']);
    expect(nodeText(['Ingot', '2 × Smelter'])).toEqual({
      title: ['Ingot'],
      details: ['2 × Smelter'],
    });
  });

  test('overlaps reports intersecting nodes and labels', () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    const node = { ...graph.nodes[0]!, ...box, text: { title: ['Ore'], details: [] }, slant: 0 };
    const found = overlaps({
      width: 20,
      height: 20,
      nodes: [node, { ...node, id: 'b', x: 5 }],
      edges: [
        {
          ...graph.edges[0]!,
          sourcePort: 'out',
          points: [],
          label: { ...box, x: 50, text: 'x' },
        },
      ],
    });
    expect(found).toEqual(['node import:ore × node b']);
  });
});
