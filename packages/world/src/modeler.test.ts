import type { Model } from '@sps/data';
import { createHighsBackend, sizeNetwork } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import sampleSave from '../../../fixtures/modeler/sample.json';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import { createWorld, type World } from './document';
import { manualEntries } from './manual';
import {
  countText,
  importModeler,
  ModelerFormatError,
  modelerNetwork,
  parseCount,
  parseModeler,
  writeModeler,
  type ModelerSheet,
  type SheetNode,
} from './modeler';
import { buildWorld, pull } from './testing';

const model = vanillaMini as Model;
const backend = createHighsBackend();
/** A small `.sfmd` save, written as Modeler writes them (stored as .json so it can be imported). */
const sample = JSON.stringify(sampleSave);

const empty = (): World => ({ ...createWorld('test'), factories: [] });
const plan = (w: World, name: string) =>
  manualEntries(w.factories.find((f) => f.name === name)!.manual!);

async function importText(text: string, world = empty()) {
  const save = parseModeler(text);
  const sizing = await sizeNetwork(modelerNetwork(save, model), backend);
  expect(sizing.status).toBe('ok');
  return importModeler(world, save, model, { sizing });
}

describe('counts', () => {
  test('Max strings read as Modeler writes them', () => {
    expect(parseCount('3')).toBe(3);
    expect(parseCount('7.5')).toBe(7.5);
    expect(parseCount('.2')).toBe(0.2);
    expect(parseCount('3/2')).toBe(1.5);
    expect(parseCount('1 1/3')).toBeCloseTo(4 / 3, 15);
    expect(parseCount('1/0')).toBeUndefined();
    expect(parseCount('lots')).toBeUndefined();
  });

  test('a count is written as a fraction that reads back exactly', () => {
    for (const n of [0, 2, 1 / 3, 2 / 3, 1.625, 0.055555555555555594, 7 / 4.4, Math.PI, 1e-7]) {
      expect(parseCount(countText(n))).toBe(n);
    }
    expect(countText(1 / 3)).toBe('1/3');
    expect(countText(1.625)).toBe('13/8');
  });
});

describe('reading a Modeler save (A56, A57)', () => {
  test('the sample imports with the expected factories, counts and report', async () => {
    const r = await importText(sample);
    const w = r.world;
    expect(w.factories.map((f) => [f.name, f.parentId ?? null])).toEqual([
      ['Main', null],
      ['Screws', 'factory-1'],
      ['Copper', null],
    ]);
    // Iron Plate and Screw have a Max; the rest are sized by the depot and the caps.
    expect(plan(w, 'Main')).toEqual([
      { recipe: 'iron-ingot', machines: expect.closeTo(2, 9) as number },
      { recipe: 'iron-plate', machines: 1.5 },
      { recipe: 'iron-rod', machines: expect.closeTo(1, 9) as number },
      { recipe: 'reinforced-iron-plate', machines: expect.closeTo(1, 9) as number },
    ]);
    expect(plan(w, 'Screws')).toEqual([{ recipe: 'screw', machines: 1.5 }]);
    // A capped Copper Ingot pushes its output on into the Wire that takes it.
    expect(plan(w, 'Copper')).toEqual([
      { recipe: 'copper-ingot', machines: 2 },
      { recipe: 'wire', machines: expect.closeTo(4, 9) as number },
    ]);
    expect(r.inferred).toBe(4);
    expect(w.links).toEqual([
      pull('link-1', 'factory-1', 'factory-2', 'iron-rod'),
      pull('link-2', 'factory-2', 'factory-1', 'screw'),
    ]);
    const main = w.factories[0]!;
    expect(main.manual?.enabled).toBe(true);
    expect(main.request.targets).toEqual([
      { item: 'reinforced-iron-plate', rate: expect.closeTo(5, 6) as number },
    ]);
    expect(main.unassignedImports).toEqual([{ item: 'iron-ore' }]);
    expect(r.report.map((l) => [l.factory ?? '', l.node ?? '', l.message])).toEqual([
      ['Main', 'Iron Ore', 'has Modeler-only settings that are not kept: Machine'],
      [
        '',
        'Iron Ore - Iron Ingot (MM Smelter Module)',
        'is left out: a Modular Miner row: our miners come from the miner model, so what it mines is imported',
      ],
      ['', 'Mystery Machine', 'is left out: not in our data'],
      [
        '',
        '',
        'Not kept as nodes, since belts are wired automatically: 1 × Dimensional Depot, 1 × Splurger',
      ],
    ]);
  });

  test('without sizing, only nodes with a Max get a count', () => {
    const save = parseModeler(sample);
    const r = importModeler(empty(), save, model);
    expect(plan(r.world, 'Main')).toEqual([{ recipe: 'iron-plate', machines: 1.5 }]);
    expect(r.inferred).toBe(0);
    expect(r.report).toContainEqual({
      node: 'Iron Rod',
      message: 'has no machine count (no Max), so it is left out',
    });
  });

  test('a save is added to the world, with fresh ids', async () => {
    const w = buildWorld([{ id: 'factory-1' }]);
    const r = await importText(sample, w);
    expect(r.factories).toEqual(['factory-2', 'factory-3', 'factory-4']);
    expect(r.world.factories[0]).toBe(w.factories[0]);
  });

  test('a malformed file is an error', () => {
    expect(() => parseModeler('not json')).toThrow(ModelerFormatError);
    expect(() => parseModeler('{"Data": 3}')).toThrow(/no "Data" list/);
    expect(() => parseModeler('{"Data": [{"X": 1}]}')).toThrow(/has no name/);
    expect(() =>
      parseModeler('{"Data": [{"Name": "Wire", "Inputs": {"Copper Ingot": [7]}}]}'),
    ).toThrow(/does not exist/);
    expect(() =>
      parseModeler(
        '{"Data": [{"Name": "Outpost", "Parent": 1}, {"Name": "Outpost", "Parent": 0}]}',
      ),
    ).toThrow(/loop of Outposts/);
    expect(() =>
      parseModeler('{"Data": [{"Name": "Wire"}, {"Name": "Cable", "Parent": 0}]}'),
    ).toThrow(/not an Outpost/);
  });
});

describe('writing a Modeler save (A58)', () => {
  // A two-factory world: "a" makes plates and rods, "b" (inside "a") makes screws from a's rods.
  const world = (): World => {
    const w = buildWorld(
      [{ id: 'a' }, { id: 'b' }],
      [pull('l1', 'a', 'b', 'iron-rod'), pull('l2', 'b', 'a', 'screw')],
    );
    w.factories[1]!.parentId = 'a';
    w.factories[0]!.name = 'Plates';
    w.factories[1]!.name = 'Screws';
    return w;
  };
  const sheets: ModelerSheet[] = [
    {
      factory: 'a',
      nodes: [
        { key: 'import:iron-ore', kind: 'in', item: 'iron-ore', x: 0, y: 0 },
        {
          key: 'recipe:iron-ingot',
          kind: 'recipe',
          recipe: 'iron-ingot',
          machines: 7 / 3,
          x: 100,
          y: 0,
        },
        {
          key: 'recipe:iron-plate',
          kind: 'recipe',
          recipe: 'iron-plate',
          machines: 1.5,
          x: 200,
          y: -50,
        },
        {
          key: 'recipe:iron-rod',
          kind: 'recipe',
          recipe: 'iron-rod',
          machines: 1 / 3,
          x: 200,
          y: 50,
        },
        { key: 'target:iron-plate', kind: 'out', item: 'iron-plate', x: 300, y: 0 },
      ],
      belts: [
        { from: 'import:iron-ore', to: 'recipe:iron-ingot', item: 'iron-ore' },
        { from: 'recipe:iron-ingot', to: 'recipe:iron-plate', item: 'iron-ingot' },
        { from: 'recipe:iron-ingot', to: 'recipe:iron-rod', item: 'iron-ingot' },
        { from: 'recipe:iron-plate', to: 'target:iron-plate', item: 'iron-plate' },
      ],
    },
    {
      factory: 'b',
      nodes: [
        { key: 'import:iron-rod', kind: 'in', item: 'iron-rod', x: 0, y: 0 },
        { key: 'recipe:screw', kind: 'recipe', recipe: 'screw', machines: 0.5, x: 100, y: 0 },
        { key: 'target:screw', kind: 'out', item: 'screw', x: 200, y: 0 },
      ],
      belts: [
        { from: 'import:iron-rod', to: 'recipe:screw', item: 'iron-rod' },
        { from: 'recipe:screw', to: 'target:screw', item: 'screw' },
      ],
    },
  ];

  test('a world becomes Outposts in a World Outpost, nested and wired along its links', () => {
    const text = writeModeler(world(), sheets, model);
    const raw = JSON.parse(text) as { Solver: string; Data: Record<string, unknown>[] };
    expect(raw.Solver).toBe('Manual');
    const names = raw.Data.map((n) => [n.Name, n.Title ?? null, n.Parent ?? null]);
    expect(names).toEqual([
      ['Outpost', 'World', null],
      ['Outpost', 'Plates', 0],
      ['Outpost', 'Screws', 1],
      ['Iron Ingot', null, 1],
      ['Iron Plate', null, 1],
      ['Iron Rod', null, 1],
      ['Screw', null, 2],
    ]);
    expect(raw.Data[3]!.Max).toBe('7/3');
    // The rod link feeds Screws' input port from a's Iron Rod node; the screw link comes back out.
    expect(raw.Data[2]!.Inputs).toEqual([[[5, 'Iron Rod']]]);
    expect(raw.Data[6]!.Inputs).toEqual({ 'Iron Rod': [[2, 0]] });
    expect(raw.Data[2]!.InteriorInputs).toEqual([[[6, 'Screw']]]);
    expect(raw.Data[1]!.Inputs).toEqual([[]]);
    expect(raw.Data[3]!.Inputs).toEqual({ 'Iron Ore': [[1, 0]] });
  });

  test('exporting and importing back gives the same recipes and machine counts, exactly', async () => {
    const w = world();
    const r = await importText(writeModeler(w, sheets, model));
    // The World Outpost holds only Outposts, so it is unwrapped.
    expect(r.world.factories.map((f) => [f.name, f.parentId ?? null])).toEqual([
      ['Plates', null],
      ['Screws', 'factory-1'],
    ]);
    expect(plan(r.world, 'Plates')).toEqual([
      { recipe: 'iron-ingot', machines: 7 / 3 },
      { recipe: 'iron-plate', machines: 1.5 },
      { recipe: 'iron-rod', machines: 1 / 3 },
    ]);
    expect(plan(r.world, 'Screws')).toEqual([{ recipe: 'screw', machines: 0.5 }]);
    // Nothing in Plates takes screws, so only the rod link has both ends.
    expect(r.world.links.map((l) => [l.from, l.to, l.item])).toEqual([
      ['factory-1', 'factory-2', 'iron-rod'],
    ]);
  });

  // One factory, balanced: ingots go to plates and rods, which both leave.
  const plates = (ingots: SheetNode[]): ModelerSheet => ({
    factory: 'a',
    nodes: [
      { key: 'ore', kind: 'in', item: 'iron-ore', x: 0, y: 0 },
      ...ingots,
      { key: 'plate', kind: 'recipe', recipe: 'iron-plate', machines: 1, x: 200, y: 0 },
      { key: 'rod', kind: 'recipe', recipe: 'iron-rod', machines: 1, x: 200, y: 100 },
      { key: 'plates', kind: 'out', item: 'iron-plate', x: 300, y: 0 },
      { key: 'rods', kind: 'out', item: 'iron-rod', x: 300, y: 100 },
    ],
    belts: [
      ...ingots.flatMap((n) => [
        { from: 'ore', to: n.key, item: 'iron-ore' },
        { from: n.key, to: 'plate', item: 'iron-ingot' },
        { from: n.key, to: 'rod', item: 'iron-ingot' },
      ]),
      { from: 'plate', to: 'plates', item: 'iron-plate' },
      { from: 'rod', to: 'rods', item: 'iron-rod' },
    ],
  });
  const ingot = (key: string, machines: number, y = 0): SheetNode => ({
    key,
    kind: 'recipe',
    recipe: 'iron-ingot',
    machines,
    x: 100,
    y,
  });
  const nodes = (text: string) =>
    (JSON.parse(text) as { Data: Record<string, unknown>[] }).Data.map((n) => ({
      name: n.Name,
      max: n.Max ?? null,
      inputs: n.Inputs ?? null,
    }));

  test('only the counts Modeler needs to work out the rest get a Max (A58)', () => {
    // Plates and rods fix the ingots: 30 + 15 a minute is 1.5 smelters.
    const text = writeModeler(world(), [plates([ingot('ingot', 1.5)])], model);
    expect(nodes(text)).toEqual([
      { name: 'Outpost', max: null, inputs: [[]] },
      { name: 'Iron Ingot', max: null, inputs: { 'Iron Ore': [[0, 0]] } },
      { name: 'Iron Plate', max: '1', inputs: { 'Iron Ingot': [[1, 'Iron Ingot']] } },
      { name: 'Iron Rod', max: '1', inputs: { 'Iron Ingot': [[1, 'Iron Ingot']] } },
    ]);
    // Each recipe node keeps our exact count for reading back.
    const raw = JSON.parse(text) as { Data: { Sps?: unknown }[] };
    expect(raw.Data[1]!.Sps).toEqual({ recipe: 'iron-ingot', machines: '3/2' });
  });

  test('what a manual plan makes beyond its use leaves through an output port', () => {
    const text = writeModeler(world(), [plates([ingot('ingot', 2)])], model);
    const raw = JSON.parse(text) as { Data: Record<string, unknown>[] };
    // 60 ingots a minute, 45 used: the extra 15 leave, and the ingots need their own Max.
    expect(raw.Data[0]!.InteriorInputs).toEqual([
      [[2, 'Iron Plate']],
      [[3, 'Iron Rod']],
      [[1, 'Iron Ingot']],
    ]);
    expect(nodes(text).map((n) => n.max)).toEqual([null, '2', '1', '1']);
  });

  test('several makers feeding several takers meet at a Splurger', () => {
    const text = writeModeler(
      world(),
      [plates([ingot('ingot-1', 1), ingot('ingot-2', 0.5, 50)])],
      model,
    );
    const hub = [
      [1, 'Iron Ingot'],
      [2, 'Iron Ingot'],
    ];
    expect(nodes(text)).toEqual([
      { name: 'Outpost', max: null, inputs: [[]] },
      // Two smelters share the ingots: one of them needs a count.
      { name: 'Iron Ingot', max: '1', inputs: { 'Iron Ore': [[0, 0]] } },
      { name: 'Iron Ingot', max: null, inputs: { 'Iron Ore': [[0, 0]] } },
      { name: 'Iron Plate', max: '1', inputs: { 'Iron Ingot': [[5, 0]] } },
      { name: 'Iron Rod', max: '1', inputs: { 'Iron Ingot': [[5, 0]] } },
      { name: 'Splurger', max: null, inputs: [hub] },
    ]);
  });

  test('a connection two links share is written once', () => {
    // Rods made in y (inside x) go to z1 and z2: both links leave x through one port.
    const w = buildWorld(
      [{ id: 'x' }, { id: 'y' }, { id: 'z1' }, { id: 'z2' }],
      [pull('l1', 'y', 'z1', 'iron-rod'), pull('l2', 'y', 'z2', 'iron-rod')],
    );
    w.factories[1]!.parentId = 'x';
    const rods = (factory: string, kind: 'in' | 'out'): ModelerSheet => ({
      factory,
      nodes: [
        { key: 'rod', kind: 'recipe', recipe: 'iron-rod', machines: 1, x: 0, y: 0 },
        { key: 'end', kind, item: 'iron-rod', x: 100, y: 0 },
      ],
      belts: [
        kind === 'out'
          ? { from: 'rod', to: 'end', item: 'iron-rod' }
          : { from: 'end', to: 'rod', item: 'iron-rod' },
      ],
    });
    const sheets = [
      { factory: 'x', nodes: [], belts: [] },
      rods('y', 'out'),
      rods('z1', 'in'),
      rods('z2', 'in'),
    ];
    const raw = JSON.parse(writeModeler(w, sheets, model)) as { Data: Record<string, unknown>[] };
    const x = raw.Data.find((n) => n.Title === 'X')!;
    expect(x.InteriorInputs).toEqual([[[raw.Data.findIndex((n) => n.Title === 'Y'), 0]]]);
  });

  test('one factory is one Outpost', async () => {
    const text = writeModeler(world(), sheets.slice(0, 1), model);
    const raw = JSON.parse(text) as { Data: Record<string, unknown>[] };
    expect(raw.Data[0]).toMatchObject({ Name: 'Outpost', Title: 'Plates' });
    expect(raw.Data[0]!.Parent).toBeUndefined();
    const r = await importText(text);
    expect(r.world.factories.map((f) => f.name)).toEqual(['Plates']);
    expect(plan(r.world, 'Plates')).toHaveLength(3);
  });
});
