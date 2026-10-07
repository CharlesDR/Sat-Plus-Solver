import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import type { FactoryGraph, FlowNode } from './factory';
import {
  bandNodes,
  ICON_GAP,
  isRaw,
  layoutFactoryGraph,
  nodeText,
  orthogonal,
  overlaps,
  rateText,
  wrapText,
  type FactoryLayout,
} from './layout';

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

  test('raw inputs in a band on top, the rest left to right, with routed edges and labels', async () => {
    const l = await layoutFactoryGraph(graph, new ELK());
    const [imp, rec, tgt] = l.nodes;
    expect(imp!.band).toBe(true);
    expect(imp!.y + imp!.height).toBeLessThan(rec!.y);
    expect(rec!.x + rec!.width).toBeLessThan(tgt!.x);
    for (const e of l.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      // A line from the band shows its rate; the band node names the item (A46).
      expect(e.label.text).toBe(e.source === 'import:ore' ? '60.0' : `60.0 ${e.itemName}`);
      expect(e.label.width).toBeGreaterThan(0);
    }
    expect(overlaps(l)).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
  });

  test('one port per item on the slanted sides, the main product at the right vertex (A46)', async () => {
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
    const rec = node('recipe:ingot');
    expect(rec.slant).toBe(Math.round((rec.height * Math.tan(Math.PI / 6)) / 2));
    const outs = rec.ports.filter((p) => p.dir === 'out');
    expect(outs.map((p) => p.item).sort()).toEqual(['gas', 'ingot', 'slag']);
    // The main product at the right vertex, one byproduct above and one below.
    near(
      outs.find((p) => p.item === 'ingot')!,
      { x: rec.width, y: rec.height / 2 },
    );
    const ys = outs.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(rec.height / 2);
    expect(ys[2]).toBeGreaterThan(rec.height / 2);
    for (const p of rec.ports) {
      // On the slanted side: as far in from the box edge as the slant reaches at that height.
      const inset = (rec.slant * Math.abs(p.y - rec.height / 2)) / (rec.height / 2);
      expect(p.dir === 'in' ? p.x : rec.width - p.x).toBeCloseTo(inset, 6);
    }
    // Every line starts at its source's port for its item and ends at its target's.
    for (const e of l.edges) {
      if (node(e.source).band) continue;
      const s = node(e.source);
      const t = node(e.target);
      const from = s.ports.find((p) => p.dir === 'out' && p.item === e.item)!;
      const to = t.ports.find((p) => p.dir === 'in' && p.item === e.item)!;
      near(e.points[0]!, { x: s.x + from.x, y: s.y + from.y });
      near(e.points.at(-1)!, { x: t.x + to.x, y: t.y + to.y });
    }
    expect(overlaps(l)).toEqual([]);
  });

  test('a raw input drops a straight line beside the column of each recipe it feeds (A46)', async () => {
    const consumer = (id: string, rate: number): FlowNode => ({
      id: `recipe:${id}`,
      kind: 'recipe',
      label: id,
      recipe: id,
      machine: 'Smelter',
      machines: 1,
      machinesCeil: 1,
      main: id,
      inputs: [{ item: 'ore', rate }],
      outputs: [{ item: id, rate }],
    });
    const target = (id: string, rate: number): FlowNode => ({
      id: `target:${id}`,
      kind: 'target',
      label: id,
      item: id,
      rate,
      inputs: [{ item: id, rate }],
      outputs: [],
    });
    const g: FactoryGraph = {
      nodes: [
        graph.nodes[0]!,
        consumer('a', 20),
        consumer('b', 40),
        target('a', 20),
        target('b', 40),
      ],
      edges: [
        edge('import:ore', 'recipe:a', 'ore', 20),
        edge('import:ore', 'recipe:b', 'ore', 40),
        edge('recipe:a', 'target:a', 'a', 20),
        edge('recipe:b', 'target:b', 'b', 40),
      ],
    };
    const l = await layoutFactoryGraph(g, new ELK());
    const node = (id: string) => l.nodes.find((n) => n.id === id)!;
    const imp = node('import:ore');
    for (const id of ['recipe:a', 'recipe:b']) {
      const e = l.edges.find((x) => x.target === id)!;
      const t = node(id);
      // From the band node's bottom, along the bus, down, then in to the port.
      expect(e.points[0]!.y).toBeCloseTo(imp.y + imp.height, 6);
      const down = e.points.at(-3)!;
      const turn = e.points.at(-2)!;
      expect(turn.x).toBe(down.x);
      expect(turn.x).toBeLessThan(t.x);
      expect(turn.y).toBeCloseTo(e.points.at(-1)!.y, 6);
      // The line comes down left of every node in the recipe's column.
      for (const n of l.nodes)
        if (!n.band && n.x < t.x + t.width && t.x < n.x + n.width) expect(turn.x).toBeLessThan(n.x);
      // Its label sits beside the recipe, above the line's end.
      // The band node names the item; the line's label is its rate.
      expect(e.label.text).toBe(rateText(e.rate));
      expect(e.label.x + e.label.width).toBeLessThanOrEqual(t.x - 6);
      expect(e.label.y + e.label.height).toBeLessThan(turn.y);
    }
    expect(overlaps(l)).toEqual([]);
  });

  test('a fan-out is a bundle: a trunk labelled with the total, branches with their rates (A46)', async () => {
    const make = (id: string, rate: number): FlowNode => ({
      id: `target:${id}`,
      kind: 'target',
      label: id,
      item: 'ingot',
      rate,
      inputs: [{ item: 'ingot', rate }],
      outputs: [],
    });
    const g: FactoryGraph = {
      nodes: [graph.nodes[0]!, graph.nodes[1]!, make('x', 20), make('y', 40)],
      edges: [
        graph.edges[0]!,
        { ...edge('recipe:ingot', 'target:x', 'ingot', 20), itemName: 'Ingot' },
        { ...edge('recipe:ingot', 'target:y', 'ingot', 40), itemName: 'Ingot' },
      ],
    };
    const l = await layoutFactoryGraph(g, new ELK());
    expect(l.bundles).toHaveLength(1);
    const b = l.bundles[0]!;
    expect(b).toMatchObject({ source: 'recipe:ingot', item: 'ingot', rate: 60 });
    expect(b.label.text).toBe('60.0 Ingot');
    const branches = l.edges.filter((e) => e.source === 'recipe:ingot');
    expect(branches.map((e) => e.label.text).sort()).toEqual(['20.0', '40.0']);
    // Both branches run through the split point.
    const onRoute = (pts: { x: number; y: number }[], q: { x: number; y: number }) =>
      pts.slice(1).some((p, k) => {
        const a = pts[k]!;
        const within = (v: number, u: number, w: number) =>
          v >= Math.min(u, w) - 1.5 && v <= Math.max(u, w) + 1.5;
        return within(q.x, a.x, p.x) && within(q.y, a.y, p.y);
      });
    for (const e of branches) expect(onRoute(e.points, b.split)).toBe(true);
    expect(overlaps(l)).toEqual([]);
  });

  test('isRaw: imports, missing inputs, resource nodes and recipes that take nothing', () => {
    const n = (kind: FlowNode['kind'], inputs: number): FlowNode => ({
      id: kind,
      kind,
      label: kind,
      inputs: Array.from({ length: inputs }, () => ({ item: 'water', rate: 1 })),
      outputs: [],
    });
    expect(isRaw(n('import', 0))).toBe(true);
    expect(isRaw(n('missing', 0))).toBe(true);
    expect(isRaw(n('resource', 1))).toBe(true);
    expect(isRaw(n('recipe', 0))).toBe(true);
    expect(isRaw(n('recipe', 1))).toBe(false);
    expect(isRaw(n('target', 1))).toBe(false);
    expect(isRaw(n('byproduct', 1))).toBe(false);
  });

  test('bandNodes: a raw input fed from the chart is drawn in the chart, so no line rises (A46)', () => {
    const n = (id: string, kind: FlowNode['kind'], inputs: string[]): FlowNode => ({
      id,
      kind,
      label: id,
      inputs: inputs.map((item) => ({ item, rate: 1 })),
      outputs: [],
    });
    const g: FactoryGraph = {
      nodes: [
        n('water', 'recipe', []),
        n('miner-wet', 'resource', ['water']),
        n('acid', 'recipe', ['water']),
        n('miner-acid', 'resource', ['acid']),
      ],
      edges: [
        edge('water', 'miner-wet', 'water', 1),
        edge('water', 'acid', 'water', 1),
        edge('acid', 'miner-acid', 'acid', 1),
      ],
    };
    expect([...bandNodes(g)].sort()).toEqual(['miner-wet', 'water']);
  });

  test('orthogonal: a route with a slanted segment is redrawn square', () => {
    const p = (x: number, y: number) => ({ x, y });
    expect(orthogonal([p(0, 0), p(10, 0), p(10, 5)])).toEqual([p(0, 0), p(10, 0), p(10, 5)]);
    // ELK's stale bend points on a straightened edge.
    expect(orthogonal([p(0, 5), p(-4, 1), p(-4, 9), p(20, 5)])).toEqual([p(0, 5), p(20, 5)]);
    expect(orthogonal([p(0, 0), p(3, 4), p(10, 10)])).toEqual([
      p(0, 0),
      p(5, 0),
      p(5, 10),
      p(10, 10),
    ]);
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
    // A line from the band is labelled with its rate, beside the node (A46).
    expect(l.edges[0]!.label.text).toBe('60.0');
    expect(overlaps(l)).toEqual([]);
  });

  test('custom edge labels size the label boxes', async () => {
    const l = await layoutFactoryGraph(graph, new ELK(), { edgeLabel: (e) => e.item });
    expect(l.edges.map((e) => e.label.text)).toEqual(['ore', 'ingot']);
    expect(l.edges[1]!.label.width).toBeLessThan(
      (await layoutFactoryGraph(graph, new ELK())).edges[1]!.label.width,
    );
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
    const node = {
      ...graph.nodes[0]!,
      ...box,
      text: { title: ['Ore'], details: [] },
      slant: 0,
      band: false,
      ports: [],
    };
    const layout: FactoryLayout = {
      width: 20,
      height: 20,
      nodes: [node, { ...node, id: 'b', x: 5 }],
      edges: [
        {
          ...graph.edges[0]!,
          points: [],
          label: { ...box, x: 50, text: 'x' },
        },
      ],
      bundles: [
        {
          source: 'import:ore',
          item: 'ore',
          rate: 1,
          split: { x: 0, y: 0 },
          label: { ...box, x: 55, text: 'y' },
        },
      ],
    };
    expect(overlaps(layout)).toEqual([
      'node import:ore × node b',
      'label import:ore→recipe:ingot:ore × trunk import:ore:ore',
    ]);
  });
});
