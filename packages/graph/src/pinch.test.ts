import { describe, expect, test } from 'vitest';
import { groupAreas } from './areas';
import type { FactoryGraph, FlowEdge, FlowNode } from './factory';
import { PINCH_MAX, PINCH_MIN, pinchAreas } from './pinch';

const box = (
  id: string,
  inputs: string[],
  outputs: string[],
  kind: FlowNode['kind'] = 'recipe',
): FlowNode => ({
  id: `recipe:${id}`,
  kind,
  label: id,
  recipe: id,
  machine: 'M',
  machines: 1,
  power: 1,
  main: outputs[0]!,
  inputs: inputs.map((item) => ({ item, rate: 1 })),
  outputs: outputs.map((item) => ({ item, rate: 1 })),
});
const end = (kind: 'target' | 'byproduct' | 'import', item: string): FlowNode => ({
  id: `${kind}:${item}`,
  kind,
  label: item,
  item,
  rate: 1,
  inputs: kind === 'import' ? [] : [{ item, rate: 1 }],
  outputs: kind === 'import' ? [{ item, rate: 1 }] : [],
});
const line = (source: string, target: string, item: string, rate = 1): FlowEdge => ({
  id: `${source}→${target}:${item}`,
  source,
  target,
  item,
  itemName: item[0]!.toUpperCase() + item.slice(1),
  rate,
});

/**
 * A polymer module (oil and water into a refinery, its resin and residue into
 * plastic and rubber) beside an iron chain (ore, smelters, plates, rods,
 * screws, frames, casings); a final line takes plastic, rubber, frames and
 * casings. Each module sends out only its products.
 */
function plan(): FactoryGraph {
  const r = (id: string) => `recipe:${id}`;
  const nodes = [
    box('oil', [], ['crude'], 'resource'),
    box('water', [], ['water'], 'resource'),
    box('refinery', ['crude'], ['resin', 'residue']),
    box('residue-fuel', ['residue', 'water'], ['fuel']),
    box('plastic', ['resin', 'water'], ['plastic']),
    box('rubber', ['fuel', 'water'], ['rubber']),
    box('ore', [], ['ore'], 'resource'),
    box('smelt-1', ['ore'], ['ingot']),
    box('smelt-2', ['ore'], ['ingot']),
    box('plate', ['ingot'], ['plate']),
    box('rod', ['ingot'], ['rod']),
    box('screw', ['rod'], ['screw']),
    box('rip', ['plate', 'screw'], ['rip']),
    box('frame', ['rip', 'rod'], ['frame']),
    box('casing', ['plate', 'screw'], ['casing']),
    box('final', ['plastic', 'rubber', 'frame', 'casing'], ['computer']),
    box('test', ['computer'], ['tested']),
    box('pack', ['tested'], ['packed']),
    box('ship', ['packed'], ['shipped']),
    end('target', 'shipped'),
  ];
  const edges = [
    line(r('oil'), r('refinery'), 'crude'),
    line(r('refinery'), r('plastic'), 'resin'),
    line(r('refinery'), r('residue-fuel'), 'residue'),
    line(r('residue-fuel'), r('rubber'), 'fuel'),
    line(r('water'), r('plastic'), 'water'),
    line(r('water'), r('rubber'), 'water'),
    line(r('water'), r('residue-fuel'), 'water'),
    line(r('plastic'), r('final'), 'plastic'),
    line(r('rubber'), r('final'), 'rubber'),
    line(r('ore'), r('smelt-1'), 'ore'),
    line(r('ore'), r('smelt-2'), 'ore'),
    line(r('smelt-1'), r('plate'), 'ingot'),
    line(r('smelt-2'), r('rod'), 'ingot'),
    line(r('rod'), r('screw'), 'rod'),
    line(r('rod'), r('frame'), 'rod'),
    line(r('plate'), r('rip'), 'plate'),
    line(r('screw'), r('rip'), 'screw'),
    line(r('rip'), r('frame'), 'rip'),
    line(r('plate'), r('casing'), 'plate'),
    line(r('screw'), r('casing'), 'screw'),
    line(r('frame'), r('final'), 'frame'),
    line(r('casing'), r('final'), 'casing'),
    line(r('final'), r('test'), 'computer'),
    line(r('test'), r('pack'), 'tested'),
    line(r('pack'), r('ship'), 'packed'),
    line(r('ship'), 'target:shipped', 'shipped'),
  ].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { nodes, edges };
}

describe('pinch-point areas (A87)', () => {
  test('modules that send out only their products become areas, named after them, the one with most work behind it first', () => {
    const { at, areas } = pinchAreas(plan());
    const polymer = at.get('recipe:plastic')!;
    for (const id of ['oil', 'water', 'refinery', 'residue-fuel', 'rubber'])
      expect(at.get(`recipe:${id}`)).toBe(polymer);
    expect(areas.find((a) => a.id === polymer)?.name).toBe('Rubber & Plastic');
    expect(polymer).toBe('pp:plastic+rubber');
    // Every box has an area, and every area is within the size band here.
    expect(at.size).toBe(19);
    const sizes = new Map<string, number>();
    for (const a of at.values()) sizes.set(a, (sizes.get(a) ?? 0) + 1);
    for (const n of sizes.values()) {
      expect(n).toBeGreaterThanOrEqual(PINCH_MIN);
      expect(n).toBeLessThanOrEqual(PINCH_MAX);
    }
    // Areas come in production order: what feeds an area comes first.
    expect(areas.at(-1)!.id).toBe(at.get('recipe:final'));
    expect(areas.map((a) => a.name)).toEqual(['Rubber & Plastic', 'Frame & Casing', 'Shipped']);
  });

  test('is the default grouping, counts the parts crossing each border, and repeats', () => {
    const g = plan();
    const grouped = groupAreas(g, undefined);
    expect(grouped.areas?.length).toBeGreaterThan(1);
    const polymer = grouped.areas!.find((a) => a.id === 'pp:plastic+rubber')!;
    expect(polymer).toMatchObject({ ins: 0, outs: 2, machines: 6 });
    expect(groupAreas(g, undefined)).toEqual(grouped);
    // Names and moves apply to pinch areas as to part-type ones.
    const renamed = groupAreas(g, undefined, {
      names: { 'pp:plastic+rubber': 'Polymers' },
      moves: { 'recipe:water': grouped.nodes.find((n) => n.id === 'recipe:final')!.area! },
    });
    expect(renamed.areas!.find((a) => a.id === 'pp:plastic+rubber')!.name).toBe('Polymers');
    expect(renamed.nodes.find((n) => n.id === 'recipe:water')!.area).not.toBe('pp:plastic+rubber');
    // The target sits with its maker.
    expect(grouped.nodes.find((n) => n.id === 'target:shipped')!.area).toBe(
      grouped.nodes.find((n) => n.id === 'recipe:final')!.area,
    );
  });
});
