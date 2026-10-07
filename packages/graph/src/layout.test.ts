import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import type { FactoryGraph, FlowNode } from './factory';
import {
  ICON_GAP,
  LABEL_ICON_GAP,
  isRaw,
  layoutFactoryGraph,
  multiStageInputs,
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

  test('left to right, each line labelled with its rate just before the port it enters (A48)', async () => {
    const l = await layoutFactoryGraph(graph, new ELK());
    const [imp, rec, tgt] = l.nodes;
    expect(imp!.x + imp!.width).toBeLessThan(rec!.x);
    expect(rec!.x + rec!.width).toBeLessThan(tgt!.x);
    for (const e of l.edges) {
      const t = l.nodes.find((n) => n.id === e.target)!;
      const end = e.points.at(-1)!;
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      expect(e.label.text).toBe('60.0');
      // Left of the node it enters, clear of it, and just above the line's end.
      expect(e.label.x + e.label.width).toBeCloseTo(t.x - 6, 6);
      expect(e.label.y + e.label.height).toBeCloseTo(end.y - 2, 6);
      expect(end.x - e.label.x).toBeLessThan(e.label.width + 6 + t.slant + 1);
    }
    expect(overlaps(l)).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
  });

  test('inputs on the slanted side; outputs on the tray, the main product in the middle (A46, A48)', async () => {
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
    const l = await layoutFactoryGraph(g, new ELK(), { labelIconSize: 16 });
    const node = (id: string) => l.nodes.find((n) => n.id === id)!;
    const near = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      expect(p.x).toBeCloseTo(q.x, 6);
      expect(p.y).toBeCloseTo(q.y, 6);
    };
    const rec = node('recipe:ingot');
    expect(rec.slant).toBe(Math.round((rec.height * Math.tan(Math.PI / 6)) / 2));
    const outs = rec.ports.filter((p) => p.dir === 'out');
    expect(outs.map((p) => p.item).sort()).toEqual(['gas', 'ingot', 'slag']);
    // The main product level with the hexagon's right vertex, one byproduct
    // above and one below, all on the tray's right edge.
    near(
      outs.find((p) => p.item === 'ingot')!,
      { x: rec.width, y: rec.height / 2 },
    );
    const ys = outs.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeLessThan(rec.height / 2);
    expect(ys[2]).toBeGreaterThan(rec.height / 2);
    for (const p of outs) expect(p.x).toBe(rec.width);
    // One tray row per output, centred on its port, wide enough for its rate.
    expect(rec.rows.map((r) => [r.item, r.y])).toEqual(
      rec.outputs.map((f) => [f.item, outs.find((p) => p.item === f.item)!.y]),
    );
    expect(rec.tray).toBe(2 * 4 + 16 + 3 + '60.0'.length * 8.5);
    for (const p of rec.ports.filter((q) => q.dir === 'in')) {
      // On the slanted side: as far in from the box edge as the slant reaches at that height.
      const inset = (rec.slant * Math.abs(p.y - rec.height / 2)) / (rec.height / 2);
      expect(p.x).toBeCloseTo(inset, 6);
    }
    // Every line starts at its source's port for its item and ends at its target's.
    for (const e of l.edges) {
      const s = node(e.source);
      const t = node(e.target);
      const from = s.ports.find((p) => p.dir === 'out' && p.item === e.item)!;
      const to = t.ports.find((p) => p.dir === 'in' && p.item === e.item)!;
      near(e.points[0]!, { x: s.x + from.x, y: s.y + from.y });
      near(e.points.at(-1)!, { x: t.x + to.x, y: t.y + to.y });
    }
    expect(overlaps(l)).toEqual([]);
  });

  test('labels of lines entering one port stack above it (A48)', async () => {
    const source = (id: string, rate: number): FlowNode => ({
      id: `import:${id}`,
      kind: 'import',
      label: id,
      item: 'ore',
      rate,
      inputs: [],
      outputs: [{ item: 'ore', rate }],
    });
    const g: FactoryGraph = {
      nodes: [source('a', 20), source('b', 40), ...graph.nodes.slice(1)],
      edges: [
        edge('import:a', 'recipe:ingot', 'ore', 20),
        edge('import:b', 'recipe:ingot', 'ore', 40),
        graph.edges[1]!,
      ],
    };
    const l = await layoutFactoryGraph(g, new ELK());
    const rec = l.nodes.find((n) => n.id === 'recipe:ingot')!;
    const port = rec.ports.find((p) => p.dir === 'in')!;
    const [lower, upper] = l.edges
      .filter((e) => e.target === rec.id)
      .map((e) => e.label)
      .sort((a, b) => b.y - a.y);
    expect(lower!.y + lower!.height).toBeCloseTo(rec.y + port.y - 2, 6);
    expect(upper!.y + upper!.height).toBeLessThanOrEqual(lower!.y - 6);
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
    expect(b.label.text).toBe('60.0');
    // The total sits just before the split point, above the trunk.
    expect(b.label.x + b.label.width).toBeLessThanOrEqual(b.split.x);
    expect(b.label.y + b.label.height).toBeCloseTo(b.split.y - 2, 6);
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

  test('multiStageInputs: raw inputs used at more than one stage, with how many (A47)', () => {
    const n = (id: string, kind: FlowNode['kind'], inputs: string[]): FlowNode => ({
      id,
      kind,
      label: id,
      inputs: inputs.map((item) => ({ item, rate: 1 })),
      outputs: [],
    });
    // Ore feeds two smelters side by side; Water feeds a smelter and, two
    // stages on, the radiator.
    const g: FactoryGraph = {
      nodes: [
        n('ore', 'resource', []),
        n('water', 'recipe', []),
        n('smelt-a', 'recipe', ['ore', 'water']),
        n('smelt-b', 'recipe', ['ore']),
        n('plate', 'recipe', ['ingot']),
        n('radiator', 'recipe', ['plate', 'water']),
      ],
      edges: [
        edge('ore', 'smelt-a', 'ore', 1),
        edge('ore', 'smelt-b', 'ore', 1),
        edge('water', 'smelt-a', 'water', 1),
        edge('water', 'radiator', 'water', 1),
        edge('smelt-a', 'plate', 'ingot', 1),
        edge('smelt-b', 'plate', 'ingot', 1),
        edge('plate', 'radiator', 'plate', 1),
      ],
    };
    expect(multiStageInputs(g)).toEqual(new Map([['water', 2]]));
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

  test('long node text wraps, and taller boxes fit it', async () => {
    const g = JSON.parse(JSON.stringify(graph)) as FactoryGraph;
    g.nodes[1]!.label = 'Siterite Ore (impure) → Iron Ingot with Water';
    g.nodes[1]!.machine = 'Flexible Blast Furnace';
    const l = await layoutFactoryGraph(g, new ELK());
    const rec = l.nodes[1]!;
    expect(rec.text).toEqual({
      // 18 characters a line, so hexagons stay wide and short (A40).
      title: ['Siterite Ore', '(impure) → Iron', 'Ingot with Water'],
      details: ['2.0 × Flexible', 'Blast Furnace'],
    });
    expect(rec.height).toBeGreaterThan(l.nodes[0]!.height * 2);
    expect(overlaps(l)).toEqual([]);
  });

  test('a label icon widens every line label and tray row by its size and gap (A48)', async () => {
    const plain = await layoutFactoryGraph(graph, new ELK());
    const iconed = await layoutFactoryGraph(graph, new ELK(), { labelIconSize: 16 });
    plain.edges.forEach((e, k) => {
      expect(iconed.edges[k]!.label.width).toBe(e.label.width + 16 + LABEL_ICON_GAP);
      expect(iconed.edges[k]!.label.text).toBe(e.label.text);
    });
    plain.nodes.forEach((n, k) => {
      expect(iconed.nodes[k]!.tray).toBe(n.tray ? n.tray + 16 + LABEL_ICON_GAP : 0);
    });
    expect(overlaps(iconed)).toEqual([]);
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
      tray: 0,
      rows: [],
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
