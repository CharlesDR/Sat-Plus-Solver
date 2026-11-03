import { describe, expect, test } from 'vitest';
import { groupAreas, type AreaCatalog } from './areas';
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

/** Ore Processing holds the raw and smelted items (A62's `raw` rule area). */
const oreCatalog = (raw: string[]): AreaCatalog => ({
  areas: [
    { id: 'ore', name: 'Ore Processing', rule: 'raw' },
    { id: 'parts', name: 'Parts' },
    { id: 'final', name: 'Final Assembly', rule: 'targets' },
  ],
  itemArea: (item) => (raw.includes(item) ? 'ore' : 'parts'),
});

describe('the ore band (A107)', () => {
  test('boxes making raw and smelted items come first as Ore Processing; pinch points group the rest', () => {
    const g = groupAreas(plan(), oreCatalog(['crude', 'water', 'ore', 'ingot']));
    const area = (id: string) => g.nodes.find((n) => n.id === `recipe:${id}`)!.area;
    for (const id of ['oil', 'water', 'ore', 'smelt-1', 'smelt-2'])
      expect(area(id)).toBe('pp:band:ore');
    expect(g.areas![0]).toMatchObject({ id: 'pp:band:ore', name: 'Ore Processing' });
    expect(g.areas!.filter((a) => a.name === 'Ore Processing')).toHaveLength(1);
    // The polymer module keeps its own area, now fed by the band.
    expect(area('refinery')).toBe(area('rubber'));
    expect(area('refinery')).not.toBe('pp:band:ore');
    expect(groupAreas(plan(), oreCatalog(['crude', 'water', 'ore', 'ingot']))).toEqual(g);
  });

  test('a band over PINCH_MAX boxes splits into Extraction and Smelting', () => {
    const r = (id: string) => `recipe:${id}`;
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    for (let k = 0; k < 9; k++) {
      nodes.push(box(`ore-${k}`, [], ['ore'], 'resource'), box(`smelt-${k}`, ['ore'], ['ingot']));
      edges.push(
        line(r(`ore-${k}`), r(`smelt-${k}`), 'ore'),
        line(r(`smelt-${k}`), r('plate'), 'ingot'),
      );
    }
    nodes.push(box('plate', ['ingot'], ['plate']), end('target', 'plate'));
    edges.push(line(r('plate'), 'target:plate', 'plate'));
    const g = groupAreas(
      { nodes, edges: edges.sort((a, b) => (a.id < b.id ? -1 : 1)) },
      oreCatalog(['ore', 'ingot']),
    );
    const area = (id: string) => g.nodes.find((n) => n.id === r(id))!.area;
    expect(g.areas!.slice(0, 2).map((a) => [a.id, a.name])).toEqual([
      ['pp:band:extraction', 'Extraction'],
      ['pp:band:smelting', 'Smelting'],
    ]);
    for (let k = 0; k < 9; k++) {
      expect(area(`ore-${k}`)).toBe('pp:band:extraction');
      expect(area(`smelt-${k}`)).toBe('pp:band:smelting');
    }
    expect(area('plate')).not.toMatch(/^pp:band:/);
  });

  test('small pieces only the band feeds join an area they share parts with, or each other', () => {
    const r = (id: string) => `recipe:${id}`;
    /** The band (ore, smelter, oil) and whatever `pieces` it feeds, each piece ending in a target. */
    const fed = (pieces: [string, string[], string][]) => {
      const nodes = [
        box('ore', [], ['ore'], 'resource'),
        box('smelt', ['ore'], ['ingot']),
        box('oil', [], ['crude'], 'resource'),
      ];
      const edges = [line(r('ore'), r('smelt'), 'ore')];
      const maker = new Map([
        ['ore', 'ore'],
        ['ingot', 'smelt'],
        ['crude', 'oil'],
      ]);
      for (const [id, , out] of pieces) maker.set(out, id);
      const used = new Set(pieces.flatMap(([, ins]) => ins));
      for (const [id, ins, out] of pieces) {
        nodes.push(box(id, ins, [out]));
        for (const i of ins) edges.push(line(r(maker.get(i)!), r(id), i));
        if (!used.has(out)) {
          nodes.push(end('target', out));
          edges.push(line(r(id), `target:${out}`, out));
        }
      }
      const band = new Set([r('ore'), r('smelt'), r('oil')]);
      const graph = { nodes, edges: edges.sort((a, b) => (a.id < b.id ? -1 : 1)) };
      return { band, ...pinchAreas(graph, band) };
    };
    // Wire shares Ingot with the plate module, so it joins it.
    const joined = fed([
      ['plate', ['ingot'], 'plate'],
      ['rod', ['ingot'], 'rod'],
      ['screw', ['rod'], 'screw'],
      ['rip', ['plate', 'screw'], 'rip'],
      ['wire', ['ingot'], 'wire'],
      ['cable', ['wire'], 'cable'],
    ]);
    for (const id of joined.band) expect(joined.at.has(id)).toBe(false);
    expect(joined.at.get(r('wire'))).toBe(joined.at.get(r('plate')));
    expect(joined.at.get(r('cable'))).toBe(joined.at.get(r('plate')));
    // Two small pieces that share nothing share one area rather than stand alone.
    const left = fed([
      ['wire', ['ingot'], 'wire'],
      ['cable', ['wire'], 'cable'],
      ['plastic', ['crude'], 'plastic'],
      ['sheet', ['plastic'], 'sheet'],
    ]);
    expect(new Set(left.at.values()).size).toBe(1);
    expect(left.areas).toHaveLength(1);
    // With the band apart, no other area is named Ore Processing.
    expect([...joined.areas, ...left.areas].map((a) => a.name)).not.toContain('Ore Processing');
  });
});
