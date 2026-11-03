import { describe, expect, test } from 'vitest';
import { groupAreas, type AreaCatalog } from './areas';
import { bandAreas, oreBand } from './band';
import type { FactoryGraph, FlowEdge, FlowNode } from './factory';
import { productLines } from './lines';

/** Display names, as the data build gives them; the band rules read them. */
const NAMES: Record<string, string> = {
  ore: 'Iron Ore',
  'copper-ore': 'Copper Ore',
  crushed: 'Crushed Iron',
  ingot: 'Iron Ingot',
  'copper-ingot': 'Copper Ingot',
  molten: 'Molten Iron',
  steel: 'Molten Steel',
  rod: 'Steel Rod',
  water: 'Water',
  steam: 'Steam',
  slag: 'Slag',
};
const RAW = ['ore', 'copper-ore', 'crushed', 'ingot', 'copper-ingot', 'molten', 'water', 'steam'];
const FLUID = ['water', 'steam', 'molten', 'steel'];
const isRaw = (i: string) => RAW.includes(i);
const isFluid = (i: string) => FLUID.includes(i);
const catalog: AreaCatalog = {
  areas: [
    { id: 'ore', name: 'Ore Processing', rule: 'raw' },
    { id: 'parts', name: 'Parts' },
  ],
  itemArea: (i) => (isRaw(i) ? 'ore' : 'parts'),
  isFluid,
};

type Flow = string | [string, number];
const flow = (f: Flow) =>
  typeof f === 'string' ? { item: f, rate: 1 } : { item: f[0], rate: f[1] };
const r = (id: string) => `recipe:${id}`;
const box = (
  id: string,
  ins: Flow[],
  outs: Flow[],
  kind: FlowNode['kind'] = 'recipe',
): FlowNode => ({
  id: r(id),
  kind,
  label: id,
  recipe: id,
  machines: 1,
  power: 1,
  main: flow(outs[0]!).item,
  inputs: ins.map(flow),
  outputs: outs.map(flow),
});
const target = (item: string): FlowNode => ({
  id: `target:${item}`,
  kind: 'target',
  label: item,
  item,
  rate: 1,
  inputs: [{ item, rate: 1 }],
  outputs: [],
});
/** A plan from its nodes and `[from, to, item, rate]` lines (ids without `recipe:`). */
function plan(nodes: FlowNode[], lines: [string, string, string, number?][]): FactoryGraph {
  const id = (x: string) => (x.includes(':') ? x : r(x));
  const edges = lines.map(([a, b, item, rate = 1]): FlowEdge => {
    const source = id(a);
    const t = id(b);
    return {
      id: `${source}→${t}:${item}`,
      source,
      target: t,
      item,
      itemName: NAMES[item] ?? item,
      rate,
    };
  });
  return { nodes, edges: edges.sort((a, b) => (a.id < b.id ? -1 : 1)) };
}

describe('the ore band (A107)', () => {
  test('ore work up to ingots, and every box making or using molten metal', () => {
    const g = plan(
      [
        box('mine', [], ['ore'], 'resource'),
        box('crush', ['ore'], ['crushed']),
        box('smelt', ['crushed'], ['ingot']),
        box('plate', ['ingot'], ['plate']),
        box('melt', ['crushed'], ['molten']),
        box('alloy', ['molten', 'carbon'], ['steel']),
        box('cast', ['steel'], ['rod']),
        box('remelt', ['scrap'], ['molten']),
        box('pump', [], ['water'], 'resource'),
        box('filter', ['crushed'], ['water']),
        box('boil', ['water'], ['steam']),
        box('carbon', [], ['carbon']),
        box('scrap', [], ['scrap']),
      ],
      [
        ['mine', 'crush', 'ore'],
        ['crush', 'smelt', 'crushed'],
        ['crush', 'melt', 'crushed'],
        ['crush', 'filter', 'crushed'],
        ['smelt', 'plate', 'ingot'],
        ['melt', 'alloy', 'molten'],
        ['remelt', 'alloy', 'molten'],
        ['carbon', 'alloy', 'carbon'],
        ['alloy', 'cast', 'steel'],
        ['scrap', 'remelt', 'scrap'],
        ['pump', 'boil', 'water'],
      ],
    );
    const band = oreBand(g, isRaw, isFluid);
    expect(Object.fromEntries(band)).toEqual({
      [r('mine')]: false,
      [r('crush')]: false,
      [r('smelt')]: true,
      [r('melt')]: false,
      [r('alloy')]: false,
      [r('cast')]: true,
      // Molten metal stays in the band even when the band does not feed it.
      [r('remelt')]: false,
    });
  });

  test('up to PINCH_MAX boxes the band is one area', () => {
    const g = plan(
      [box('mine', [], ['ore'], 'resource'), box('smelt', ['ore'], ['ingot'])],
      [['mine', 'smelt', 'ore']],
    );
    const { at, areas } = bandAreas(g, oreBand(g, isRaw, isFluid));
    expect(areas).toEqual([{ id: 'pp:band:ore', name: 'Ore Processing' }]);
    expect([...at.values()]).toEqual(['pp:band:ore', 'pp:band:ore']);
  });

  /** Eight iron and eight copper boxes; `slag` iron slag feeds each copper smelter. */
  const metals = (slag: number) => {
    const nodes: FlowNode[] = [];
    const lines: [string, string, string, number?][] = [];
    for (let k = 0; k < 4; k++) {
      nodes.push(
        box(`iron-mine-${k}`, [], ['ore'], 'resource'),
        box(`iron-smelt-${k}`, ['ore'], slag ? ['ingot', ['slag', slag]] : ['ingot']),
        box(`copper-mine-${k}`, [], ['copper-ore'], 'resource'),
        box(`copper-smelt-${k}`, slag ? ['copper-ore', ['slag', slag]] : ['copper-ore'], [
          'copper-ingot',
        ]),
      );
      lines.push(
        [`iron-mine-${k}`, `iron-smelt-${k}`, 'ore'],
        [`copper-mine-${k}`, `copper-smelt-${k}`, 'copper-ore'],
        [`iron-smelt-${k}`, 'target:ingot', 'ingot'],
        [`copper-smelt-${k}`, 'target:copper-ingot', 'copper-ingot'],
      );
      if (slag) lines.push([`iron-smelt-${k}`, `copper-smelt-${k}`, 'slag', slag]);
    }
    return plan(nodes, lines);
  };

  test('a big band splits into metal lanes when they barely trade', () => {
    const g = metals(0);
    const { at, areas } = bandAreas(g, oreBand(g, isRaw, isFluid));
    expect(areas).toEqual([
      { id: 'pp:band:copper-ingot', name: 'Copper Ingot' },
      { id: 'pp:band:iron-ingot', name: 'Iron Ingot' },
    ]);
    expect(at.get(r('iron-mine-0'))).toBe('pp:band:iron-ingot');
    expect(at.get(r('copper-mine-3'))).toBe('pp:band:copper-ingot');
  });

  test('lanes that trade more than LANE_TRADE_MAX become Extraction and Smelting', () => {
    const g = metals(1);
    const { at, areas } = bandAreas(g, oreBand(g, isRaw, isFluid));
    expect(areas.map((a) => a.name)).toEqual(['Extraction', 'Smelting']);
    expect(at.get(r('iron-mine-0'))).toBe('pp:band:extraction');
    expect(at.get(r('copper-smelt-2'))).toBe('pp:band:smelting');
  });
});

/**
 * Ore into ingots (the band), a water pump, and two product lines of five
 * boxes, each ending in its own target: frames (plates, rods, screws) and
 * motors (wire, cable, coils, stators). `rip` and `coil` make byproduct water.
 */
function twoLines(): FactoryGraph {
  return plan(
    [
      box('mine-1', [], ['ore'], 'resource'),
      box('mine-2', [], ['ore'], 'resource'),
      box('smelt-1', ['ore'], ['ingot']),
      box('smelt-2', ['ore'], ['ingot']),
      box('pump', [], [['water', 3]], 'resource'),
      box('plate', ['ingot'], ['plate']),
      box('rod', ['ingot'], ['rod']),
      box('screw', ['rod'], ['screw']),
      box('rip', ['plate', 'screw'], ['rip', 'water']),
      box('frame', ['rip', ['water', 2]], ['frame']),
      box('wire', ['ingot'], ['wire']),
      box('cable', ['wire'], ['cable']),
      box('coil', ['wire'], ['coil', 'water']),
      box('stator', ['cable', 'coil', ['water', 3]], ['stator']),
      box('motor', ['stator'], ['motor']),
      target('frame'),
      target('motor'),
    ],
    [
      ['mine-1', 'smelt-1', 'ore'],
      ['mine-2', 'smelt-2', 'ore'],
      ['smelt-1', 'plate', 'ingot'],
      ['smelt-1', 'rod', 'ingot'],
      ['smelt-2', 'wire', 'ingot'],
      ['plate', 'rip', 'plate'],
      ['rod', 'screw', 'rod'],
      ['screw', 'rip', 'screw'],
      ['rip', 'frame', 'rip'],
      ['wire', 'cable', 'wire'],
      ['wire', 'coil', 'wire'],
      ['cable', 'stator', 'cable'],
      ['coil', 'stator', 'coil'],
      ['stator', 'motor', 'stator'],
      ['frame', 'target:frame', 'frame'],
      ['motor', 'target:motor', 'motor'],
      // In node order (A24): byproduct water crosses between the lines both ways.
      ['coil', 'frame', 'water'],
      ['rip', 'stator', 'water'],
      ['pump', 'frame', 'water', 1],
      ['pump', 'stator', 'water', 2],
    ],
  );
}

describe('product lines and water (A107)', () => {
  test('each target gets a line, ranked in a column with the band in the middle', () => {
    const g = groupAreas(twoLines(), catalog);
    const area = (id: string) => g.nodes.find((n) => n.id === r(id))?.area;
    expect(g.areas!.map((a) => [a.id, a.name, a.rank])).toEqual([
      ['pp:band:ore', 'Ore Processing', 0.5],
      ['pp:line:frame', 'frame', 0],
      ['pp:line:motor', 'motor', 1],
    ]);
    for (const id of ['plate', 'rod', 'screw', 'rip', 'frame'])
      expect(area(id)).toBe('pp:line:frame');
    for (const id of ['wire', 'cable', 'coil', 'stator', 'motor'])
      expect(area(id)).toBe('pp:line:motor');
    expect(groupAreas(twoLines(), catalog)).toEqual(g);
  });

  test('byproduct water feeds its own area first, and fresh water is drawn where it is used', () => {
    const g = groupAreas(twoLines(), catalog);
    const into = (id: string) =>
      g.edges
        .filter((e) => e.target === r(id) && e.item === 'water')
        .map((e) => [e.source, e.rate]);
    expect(into('frame')).toEqual([
      [r('pump@pp:line:frame'), 1],
      [r('rip'), 1],
    ]);
    expect(into('stator')).toEqual([
      [r('coil'), 1],
      [r('pump@pp:line:motor'), 2],
    ]);
    const piece = (area: string) => g.nodes.find((n) => n.id === r(`pump@${area}`))!;
    expect(piece('pp:line:frame')).toMatchObject({ area: 'pp:line:frame', machines: 1 / 3 });
    expect(piece('pp:line:motor')).toMatchObject({ area: 'pp:line:motor', machines: 2 / 3 });
    expect(g.nodes.some((n) => n.id === r('pump'))).toBe(false);
  });

  test('moving a piece of fresh water moves its whole box', () => {
    const g = groupAreas(twoLines(), catalog, {
      moves: { [r('pump@pp:line:motor')]: 'pp:line:frame' },
    });
    const pumps = g.nodes.filter((n) => n.recipe === 'pump');
    expect(pumps.map((n) => [n.id, n.area])).toEqual([[r('pump'), 'pp:line:frame']]);
  });

  test('a part both lines use goes in Shared Parts', () => {
    const g = twoLines();
    // Screws now go half to frames and half to stators.
    g.nodes.find((n) => n.id === r('screw'))!.outputs = [{ item: 'screw', rate: 2 }];
    g.nodes.find((n) => n.id === r('stator'))!.inputs.push({ item: 'screw', rate: 1 });
    g.edges.push({
      id: `${r('screw')}→${r('stator')}:screw`,
      source: r('screw'),
      target: r('stator'),
      item: 'screw',
      itemName: 'screw',
      rate: 1,
    });
    // Paint, from plates for frames only, keeps the frame line at PINCH_MIN boxes.
    g.nodes.push(box('paint', ['plate'], ['paint']));
    g.nodes.find((n) => n.id === r('frame'))!.inputs.push({ item: 'paint', rate: 1 });
    for (const [source, target, item] of [
      ['plate', 'paint', 'plate'],
      ['paint', 'frame', 'paint'],
    ] as const)
      g.edges.push({
        id: `${r(source)}→${r(target)}:${item}`,
        source: r(source),
        target: r(target),
        item,
        itemName: item,
        rate: 1,
      });
    const lines = productLines(
      g,
      new Set([r('mine-1'), r('mine-2'), r('smelt-1'), r('smelt-2'), r('pump')]),
    );
    expect(lines?.at.get(r('screw'))).toBe('pp:lines:shared');
    expect(lines?.at.get(r('rod'))).toBe('pp:lines:shared');
    expect(lines?.at.get(r('plate'))).toBe('pp:line:frame');
    expect(lines?.areas.find((a) => a.id === 'pp:lines:shared')?.name).toBe('Shared Parts');
  });

  test('with one target the lines are its ingredients; with fewer than two lines, pinch points', () => {
    const g = twoLines();
    g.nodes = g.nodes.filter((n) => n.kind !== 'target');
    g.edges = g.edges.filter((e) => !e.target.startsWith('target:'));
    g.nodes.push(box('assemble', ['frame', 'motor'], ['machine']), target('machine'));
    g.edges.push(
      {
        id: `${r('frame')}→${r('assemble')}:frame`,
        source: r('frame'),
        target: r('assemble'),
        item: 'frame',
        itemName: 'frame',
        rate: 1,
      },
      {
        id: `${r('motor')}→${r('assemble')}:motor`,
        source: r('motor'),
        target: r('assemble'),
        item: 'motor',
        itemName: 'motor',
        rate: 1,
      },
      {
        id: `${r('assemble')}→target:machine:machine`,
        source: r('assemble'),
        target: 'target:machine',
        item: 'machine',
        itemName: 'machine',
        rate: 1,
      },
    );
    const apart = new Set([r('mine-1'), r('mine-2'), r('smelt-1'), r('smelt-2'), r('pump')]);
    const lines = productLines(g, apart)!;
    expect(lines.at.get(r('assemble'))).toBe('pp:lines:final');
    expect(lines.at.get(r('rip'))).toBe('pp:line:frame');
    expect(lines.at.get(r('coil'))).toBe('pp:line:motor');
    // Without the motor line only one line is left: nothing to stack.
    const one = {
      nodes: g.nodes.filter((n) => !['wire', 'cable', 'coil', 'stator', 'motor'].includes(n.label)),
      edges: g.edges.filter((e) => !/wire|cable|coil|stator|motor/.test(e.id)),
    };
    expect(productLines(one, apart)).toBeUndefined();
  });
});
