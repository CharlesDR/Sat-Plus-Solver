import type { LedgerRow, LinkResult } from '@sps/world';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import { worldGraph, type WorldGraph, type WorldGraphInput } from './world';
import { absolutePosition, layoutWorldGraph, worldEdgeLines, worldNodeLines } from './worldLayout';

const NAMES: Record<string, string> = {
  'iron-ore': 'Iron Ore',
  'iron-ingot': 'Iron Ingot',
  'iron-plate': 'Iron Plate',
  'iron-rod': 'Iron Rod',
  screw: 'Screw',
  'reinforced-iron-plate': 'Reinforced Iron Plate',
};
const itemName = (id: string) => NAMES[id];

const row = (item: string, r: Partial<Omit<LedgerRow, 'item'>>): LedgerRow => ({
  item,
  produced: 0,
  consumed: 0,
  target: 0,
  imported: 0,
  exported: 0,
  surplus: 0,
  unmet: 0,
  ...r,
});
const power = (draw: number) => ({ consumptionMW: draw, generationMW: 0, netMW: draw });
const link = (l: Partial<LinkResult> & Pick<LinkResult, 'id' | 'from' | 'to' | 'item'>) => ({
  mode: 'pull' as const,
  requested: 0,
  delivered: 0,
  used: 0,
  short: 0,
  ...l,
});

/**
 * Ore (factory-1) pulls 18 Iron Plate to Plates (factory-2), which makes 3
 * Reinforced Iron Plate; Ore also ships a fixed 20 Iron Ingot to Rods
 * (factory-3), which uses 10. Ore and Plates sit in group-1 ("Iron"); Plates
 * alone in group-2 ("Inner"), nested inside it. Rods imports 4 Screw from
 * nowhere (unmet). The ledgers are what `resolveWorld` reports for this world.
 */
const ore = [
  row('iron-ore', { produced: 57, consumed: 57 }),
  row('iron-ingot', { produced: 57, consumed: 27, exported: 20, target: 0 }),
  row('iron-plate', { produced: 18, exported: 18 }),
];
const plates = [
  row('iron-plate', { consumed: 18, imported: 18 }),
  row('iron-rod', { produced: 6, consumed: 6 }),
  row('screw', { produced: 36, consumed: 36 }),
  row('reinforced-iron-plate', { produced: 3, target: 3 }),
];
const rods = [
  row('iron-ingot', { consumed: 10, imported: 20, surplus: 10 }),
  row('iron-rod', { produced: 10, target: 10 }),
  row('screw', { target: 4, unmet: 4 }),
];
const result: WorldGraphInput = {
  factories: [
    {
      id: 'factory-1',
      name: 'Ore',
      groupId: 'group-1',
      status: 'ok',
      ledger: ore,
      power: power(10),
      nodes: [{ node: 'n', used: 1.5 }],
      machines: 4,
    },
    {
      id: 'factory-2',
      name: 'Plates',
      groupId: 'group-2',
      status: 'ok',
      ledger: plates,
      power: power(20),
      nodes: [],
      machines: 3,
    },
    {
      id: 'factory-3',
      name: 'Rods',
      status: 'ok',
      ledger: rods,
      power: power(4),
      nodes: [],
      machines: 1,
    },
  ],
  groups: [
    {
      id: 'group-1',
      name: 'Iron',
      factories: ['factory-1', 'factory-2'],
      ledger: [
        row('iron-ingot', { produced: 57, consumed: 27, exported: 20 }),
        row('iron-ore', { produced: 57, consumed: 57 }),
        row('iron-plate', { produced: 18, consumed: 18 }),
        ...plates.slice(1),
      ],
      power: power(30),
      nodes: [{ node: 'n', used: 1.5 }],
      machines: 7,
    },
    {
      id: 'group-2',
      name: 'Inner',
      parentId: 'group-1',
      factories: ['factory-2'],
      ledger: plates,
      power: power(20),
      nodes: [],
      machines: 3,
    },
  ],
  links: [
    link({
      id: 'link-1',
      from: 'factory-1',
      to: 'factory-2',
      item: 'iron-plate',
      requested: 18,
      delivered: 18,
      used: 18,
    }),
    link({
      id: 'link-2',
      from: 'factory-1',
      to: 'factory-3',
      item: 'iron-ingot',
      mode: 'fixed',
      requested: 20,
      delivered: 20,
      used: 10,
      transport: { kind: 'belt', tier: 1 },
      carriers: 1,
    }),
  ],
};

const ids = (g: WorldGraph) => g.nodes.map((n) => n.id);
const edgeIds = (g: WorldGraph) => g.edges.map((e) => e.id);

describe('worldGraph', () => {
  test('expanded groups are frames; links are edges labeled by item and rate', () => {
    const g = worldGraph(result, { itemName });
    expect(ids(g)).toEqual([
      'group:group-1',
      'group:group-2',
      'factory:factory-1',
      'factory:factory-2',
      'factory:factory-3',
      'stub:in:factory:factory-3',
      'stub:out:factory:factory-3',
    ]);
    const node = (id: string) => g.nodes.find((n) => n.id === id)!;
    expect(node('group:group-2').parent).toBe('group:group-1');
    expect(node('factory:factory-1').parent).toBe('group:group-1');
    expect(node('factory:factory-2').parent).toBe('group:group-2');
    expect(node('factory:factory-3').parent).toBeUndefined();
    expect(edgeIds(g)).toContain('factory:factory-1→factory:factory-2');
    const plates = g.edges.find((e) => e.id === 'factory:factory-1→factory:factory-2')!;
    expect(worldEdgeLines(plates)).toEqual(['18.0 Iron Plate']);
    expect(plates.items[0]!.links).toEqual(['link-1']);
    // Rods gets 20 ingots and uses 10: the rest is unclaimed surplus; Screw is unmet.
    expect(node('stub:out:factory:factory-3').items).toEqual([
      { item: 'iron-ingot', name: 'Iron Ingot', rate: 10 },
    ]);
    expect(node('stub:in:factory:factory-3').items).toEqual([
      { item: 'screw', name: 'Screw', rate: 4 },
    ]);
    expect(worldNodeLines(node('factory:factory-1'))[0]).toBe('Ore');
  });

  test('a collapsed group is one node; its internal links are hidden', () => {
    const g = worldGraph(result, { collapsed: ['group-1'], itemName });
    expect(ids(g)).toEqual([
      'group:group-1',
      'factory:factory-3',
      'stub:in:factory:factory-3',
      'stub:out:factory:factory-3',
    ]);
    // Only the boundary flow (ingots to Rods) is left; Ore → Plates is internal.
    expect(g.edges.filter((e) => e.kind === 'link').map((e) => e.id)).toEqual([
      'group:group-1→factory:factory-3',
    ]);
    const group = g.nodes[0]!;
    const totals = result.groups.find((x) => x.id === 'group-1')!;
    expect(group).toMatchObject({ collapsed: true, members: 2, status: 'ok' });
    expect(group.power).toEqual(totals.power);
    expect(group.machines).toBe(totals.machines);
  });

  test('a collapsed inner group shows inside its expanded parent', () => {
    const g = worldGraph(result, { collapsed: ['group-2'] });
    const inner = g.nodes.find((n) => n.id === 'group:group-2')!;
    expect(inner).toMatchObject({ collapsed: true, parent: 'group:group-1', members: 1 });
    expect(ids(g)).not.toContain('factory:factory-2');
    expect(edgeIds(g)).toContain('factory:factory-1→group:group-2');
  });

  test('item trace marks exactly the nodes and edges that touch the item', () => {
    for (const collapsed of [[], ['group-1'], ['group-2']])
      for (const item of [
        'iron-plate',
        'iron-ingot',
        'screw',
        'iron-ore',
        'reinforced-iron-plate',
      ]) {
        const g = worldGraph(result, { collapsed, traceItem: item });
        const scope = (n: WorldGraph['nodes'][number]) =>
          n.kind === 'factory'
            ? result.factories.find((f) => f.id === n.ref)!.ledger
            : result.groups.find((x) => x.id === n.ref)!.ledger;
        for (const n of g.nodes) {
          const expected =
            n.kind === 'stub'
              ? n.items!.some((i) => i.item === item)
              : n.kind === 'group' && !n.collapsed
                ? false
                : scope(n).some((r) => r.item === item);
          expect([n.id, item, n.traced]).toEqual([n.id, item, expected]);
        }
        for (const e of g.edges)
          expect([e.id, item, e.traced]).toEqual([
            e.id,
            item,
            e.items.some((i) => i.item === item),
          ]);
      }
    const plates = worldGraph(result, { traceItem: 'iron-plate' });
    expect(plates.nodes.filter((n) => n.traced).map((n) => n.id)).toEqual([
      'factory:factory-1',
      'factory:factory-2',
    ]);
    expect(plates.edges.filter((e) => e.traced).map((e) => e.id)).toEqual([
      'factory:factory-1→factory:factory-2',
    ]);
  });

  test('a short link is flagged on its edge', () => {
    const r: WorldGraphInput = {
      ...result,
      links: result.links.map((l) =>
        l.id === 'link-2' ? { ...l, delivered: 0, short: l.requested } : l,
      ),
    };
    const e = worldGraph(r, { itemName }).edges.find(
      (x) => x.id === 'factory:factory-1→factory:factory-3',
    )!;
    expect(e.short).toBe(true);
    expect(worldEdgeLines(e)).toEqual(['20.0 Iron Ingot (short 20.0)']);
  });

  test('deterministic', () => {
    expect(worldGraph(result, { collapsed: ['group-2'], traceItem: 'screw' })).toEqual(
      worldGraph(result, { collapsed: ['group-2'], traceItem: 'screw' }),
    );
  });
});

describe('layoutWorldGraph', () => {
  test('members sit inside their group frame; layout is deterministic', async () => {
    const g = worldGraph(result, { itemName });
    const a = await layoutWorldGraph(g, new ELK());
    const b = await layoutWorldGraph(g, new ELK());
    expect(a).toEqual(b);
    const byId = new Map(a.nodes.map((n) => [n.id, n]));
    for (const n of a.nodes) {
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
      if (!n.parent) continue;
      const p = byId.get(n.parent)!;
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(p.width);
      expect(n.y + n.height).toBeLessThanOrEqual(p.height);
    }
    // Edges are routed in root coordinates: each starts on its source's box.
    for (const e of a.edges) {
      expect(e.points.length).toBeGreaterThanOrEqual(2);
      const s = byId.get(e.source)!;
      const at = absolutePosition(a, e.source);
      const p = e.points[0]!;
      expect(p.x).toBeGreaterThanOrEqual(at.x - 1);
      expect(p.x).toBeLessThanOrEqual(at.x + s.width + 1);
      expect(p.y).toBeGreaterThanOrEqual(at.y - 1);
      expect(p.y).toBeLessThanOrEqual(at.y + s.height + 1);
      expect(e.label.lines.length).toBe(e.items.length);
    }
  });
});
