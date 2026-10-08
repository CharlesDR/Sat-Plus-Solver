import type { LedgerRow, LinkResult } from '@sps/world';
import { describe, expect, test } from 'vitest';
import { factoryGraph, subFactoryNodeId, type FlowchartInput } from './factory';
import { nodeLines } from './layout';
import { factoryNodeId, nestNodeId, worldGraph, type WorldGraphInput } from './world';

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

describe('sub-factories in the flowchart (A53)', () => {
  // A parent pressing 30 imported plates into Reinforced Iron Plate; 20 of
  // the plates come from its sub-factory, which also takes 5 screws from it.
  const plan: FlowchartInput = {
    status: 'ok' as const,
    recipes: [
      {
        id: 'reinforced-iron-plate',
        name: 'Reinforced Iron Plate',
        machine: 'assembler',
        machines: 1,
        machinesCeil: 1,
        inputs: [
          { item: 'iron-plate', rate: 30 },
          { item: 'screw', rate: 60 },
        ],
        outputs: [{ item: 'reinforced-iron-plate', rate: 5 }],
      },
      {
        id: 'screw',
        name: 'Screw',
        machine: 'constructor',
        machines: 1.625,
        machinesCeil: 2,
        inputs: [{ item: 'iron-rod', rate: 16.25 }],
        outputs: [{ item: 'screw', rate: 65 }],
      },
    ] as FlowchartInput['recipes'],
    items: [
      {
        item: 'reinforced-iron-plate',
        produced: 5,
        consumed: 0,
        imported: 0,
        surplus: 0,
        demand: 5,
      },
      { item: 'screw', produced: 65, consumed: 60, imported: 0, surplus: 0, demand: 5 },
    ],
    imports: [
      { item: 'iron-plate', rate: 30 },
      { item: 'iron-rod', rate: 16.25 },
    ],
    surplus: [],
  };

  test('a sub-factory is one box, its flows taken out of the imports and targets', () => {
    const g = factoryGraph(
      plan,
      {},
      [],
      [
        {
          id: 'c',
          name: 'Plate annex',
          inputs: [{ item: 'screw', rate: 5 }],
          outputs: [{ item: 'iron-plate', rate: 20 }],
        },
      ],
    );
    const box = g.nodes.find((n) => n.id === subFactoryNodeId('c'))!;
    expect(box).toMatchObject({ kind: 'sub-factory', factory: 'c', label: 'Plate annex' });
    expect(nodeLines(box)[0]).toBe('Plate annex');
    expect(g.nodes.find((n) => n.id === 'import:iron-plate')?.rate).toBe(10);
    expect(g.nodes.some((n) => n.id === 'target:screw')).toBe(false);
    expect(g.edges.find((e) => e.source === 'sub:c')).toMatchObject({
      target: 'recipe:reinforced-iron-plate',
      item: 'iron-plate',
      rate: 20,
    });
    expect(g.edges.find((e) => e.target === 'sub:c')).toMatchObject({
      source: 'recipe:screw',
      item: 'screw',
      rate: 5,
    });
  });
});

describe('sub-factories on the world graph (A53)', () => {
  const link = (l: Pick<LinkResult, 'id' | 'from' | 'to' | 'item' | 'requested'>): LinkResult => ({
    mode: 'pull',
    delivered: l.requested,
    used: l.requested,
    short: 0,
    ...l,
  });
  // "p" holds "c", which holds "gc"; "out" takes from "c".
  type F = WorldGraphInput['factories'][number];
  const input: WorldGraphInput = {
    factories: (
      [
        {
          id: 'p',
          name: 'Parent',
          status: 'ok' as const,
          ledger: [],
          power: power(1),
          nodes: [],
          machines: 1,
        },
        {
          id: 'c',
          name: 'Child',
          parentId: 'p',
          status: 'short' as const,
          ledger: [],
          power: power(2),
          nodes: [],
          machines: 2,
        },
        {
          id: 'gc',
          name: 'Grandchild',
          parentId: 'c',
          status: 'ok' as const,
          ledger: [],
          power: power(4),
          nodes: [],
          machines: 4,
        },
        {
          id: 'out',
          name: 'Out',
          status: 'ok' as const,
          ledger: [],
          power: power(0),
          nodes: [],
          machines: 0,
        },
      ] as F[]
    ).map((f): F =>
      f.id === 'p'
        ? {
            ...f,
            subtree: {
              factories: ['c', 'gc', 'p'],
              internalLinks: ['l1', 'l2'],
              boundaryLinks: ['l3'],
              ledger: [row('iron-plate', { produced: 9, exported: 9 })],
              power: power(7),
              nodes: [],
              machines: 7,
            },
            subtreeBuild: 'broken' as const,
          }
        : f,
    ),
    groups: [],
    links: [
      link({ id: 'l1', from: 'c', to: 'p', item: 'iron-plate', requested: 6 }),
      link({ id: 'l2', from: 'gc', to: 'c', item: 'iron-ingot', requested: 9 }),
      link({ id: 'l3', from: 'c', to: 'out', item: 'iron-plate', requested: 9 }),
    ],
  };

  test('a parent with sub-factories is a frame around them, nested by level', () => {
    const g = worldGraph(input);
    const parentOf = new Map(g.nodes.map((n) => [n.id, n.parent]));
    expect(g.nodes.filter((n) => n.nest).map((n) => n.id)).toEqual([
      nestNodeId('p'),
      nestNodeId('c'),
    ]);
    expect(parentOf.get(nestNodeId('c'))).toBe(nestNodeId('p'));
    expect(parentOf.get(factoryNodeId('p'))).toBe(nestNodeId('p'));
    expect(parentOf.get(factoryNodeId('c'))).toBe(nestNodeId('c'));
    expect(parentOf.get(factoryNodeId('gc'))).toBe(nestNodeId('c'));
    expect(parentOf.get(factoryNodeId('out'))).toBeUndefined();
    expect(g.edges.map((e) => e.id)).toEqual([
      'factory:c→factory:out',
      'factory:c→factory:p',
      'factory:gc→factory:c',
    ]);
  });

  test('a collapsed parent shows only the flows crossing its subtree', () => {
    const g = worldGraph(input, { collapsedFactories: ['p'] });
    const nest = g.nodes.find((n) => n.id === nestNodeId('p'))!;
    expect(nest).toMatchObject({
      kind: 'group',
      nest: true,
      ref: 'p',
      collapsed: true,
      status: 'short' as const,
      build: 'broken',
      machines: 7,
      members: 3,
    });
    expect(g.nodes.filter((n) => n.kind === 'factory').map((n) => n.ref)).toEqual(['out']);
    expect(g.edges.map((e) => e.id)).toEqual(['nest:p→factory:out']);
    expect(g.edges[0]!.items[0]).toMatchObject({ item: 'iron-plate', rate: 9 });
  });
});
