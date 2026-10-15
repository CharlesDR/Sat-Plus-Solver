import type { FactoryGraph, FlowNode } from '@sps/graph';
import { describe, expect, test } from 'vitest';
import {
  AUTO_COLLAPSE_AREA,
  AUTO_COLLAPSE_NODES,
  areaCatalog,
  areaChoices,
  autoCollapsed,
  planKey,
} from './areas';

const catalog = {
  areas: [
    { id: 'ore', name: 'Ore Processing', rule: 'raw' as const },
    { id: 'steel', name: 'Steelworks' },
  ],
  itemAreas: { 'iron-ore': 'ore', 'steel-beam': 'steel' },
};

describe('flowchart areas (A64)', () => {
  test('looks items up in the catalog', () => {
    const c = areaCatalog(catalog);
    expect(c.areas).toBe(catalog.areas);
    expect(c.itemArea('steel-beam')).toBe('steel');
    expect(c.itemArea('nope')).toBeUndefined();
  });

  test('lists every area by the factory’s names, a blank name keeping the default', () => {
    expect(areaChoices(catalog, { names: { steel: 'Steel Mill', ore: ' ' } })).toEqual([
      { id: 'ore', name: 'Ore Processing' },
      { id: 'steel', name: 'Steel Mill' },
    ]);
    expect(areaChoices(catalog, undefined).map((a) => a.name)).toEqual([
      'Ore Processing',
      'Steelworks',
    ]);
  });
});

describe('auto-collapse (A89)', () => {
  const node = (id: string, area: string, kind: FlowNode['kind'] = 'recipe'): FlowNode => ({
    id,
    kind,
    label: id,
    area,
    inputs: [],
    outputs: [],
  });
  const plan = (sizes: Record<string, number>): FactoryGraph => ({
    nodes: [
      ...Object.entries(sizes).flatMap(([a, n]) =>
        Array.from({ length: n }, (_, k) => node(`recipe:${a}-${k}`, a)),
      ),
      node('target:x', 'final', 'target'),
    ],
    edges: [],
    areas: Object.keys(sizes).map((id) => ({
      id,
      name: id,
      machines: 0,
      power: 0,
      ins: 0,
      outs: 0,
    })),
  });

  test('collapses areas of 10 or more boxes in a plan of more than 40, except the targets’ area', () => {
    expect(autoCollapsed(plan({ a: 12, b: 9, c: 10, final: 10 }))).toEqual(new Set(['a', 'c']));
    // 40 boxes is not more than 40.
    expect(autoCollapsed(plan({ a: 12, b: 8, c: 10, final: 10 })).size).toBe(0);
    expect(AUTO_COLLAPSE_NODES).toBe(40);
    expect(AUTO_COLLAPSE_AREA).toBe(10);
  });

  test('a plan is known by its nodes and grouping, not its rates', () => {
    const a = plan({ a: 3 });
    const rates = { ...a, nodes: a.nodes.map((n) => ({ ...n, rate: 7 })) };
    expect(planKey(rates, undefined)).toBe(planKey(a, {}));
    expect(planKey(a, { by: 'parts' })).not.toBe(planKey(a, undefined));
    expect(planKey(plan({ a: 4 }), undefined)).not.toBe(planKey(a, undefined));
  });
});
