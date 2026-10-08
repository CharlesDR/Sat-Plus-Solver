import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildAreas, simplestRoutes } from './areas';
import { buildModel, type BuildResult } from './build';
import { Issues } from './issues';
import type { Item, Recipe } from './model';
import type { AreasConfig } from './raw';

const item = (id: string, form: Item['form'] = 'solid'): Item => ({
  id,
  name: id.toUpperCase(),
  form,
  sinkPoints: 0,
  tier: '0-0',
});
const recipe = (
  id: string,
  inputs: string[],
  outputs: string[],
  extra: Partial<Recipe> = {},
): Recipe => ({
  id,
  name: id,
  machine: 'm',
  kind: 'production',
  alternate: false,
  tier: '0-0',
  inputs: inputs.map((i) => ({ item: i, rate: 1 })),
  outputs: outputs.map((i) => ({ item: i, rate: 1 })),
  powerMW: 1,
  clock: 1,
  source: 'dataset',
  ...extra,
});
const mine = (id: string, ore: string, out = ore) =>
  recipe(id, [], [out], { kind: 'extraction', extracts: { item: ore, rate: 1 } });

// ore → ingot → plate; ore + coal → steel → beam; plate + beam → frame;
// plate + sand → gizmo; x is reached only by an alternate; lonely by nothing.
const items = [
  ...['ore', 'coal', 'sand', 'water', 'ingot', 'plate', 'steel', 'beam', 'frame', 'gizmo'],
  ...['x', 'lonely'],
].map((i) => item(i, i === 'water' ? 'fluid' : 'solid'));
const recipes = [
  mine('mine-ore', 'ore'),
  mine('mine-coal', 'coal'),
  mine('mine-sand', 'sand'),
  mine('pump', 'water'),
  recipe('ingot', ['ore'], ['ingot']),
  recipe('ingot-wet', ['ore', 'water'], ['ingot']),
  recipe('plate', ['ingot'], ['plate']),
  recipe('steel', ['ingot', 'coal', 'water'], ['steel']),
  recipe('beam', ['steel'], ['beam']),
  recipe('frame', ['plate', 'beam'], ['frame']),
  recipe('gizmo', ['plate', 'sand'], ['gizmo']),
  recipe('x', ['plate'], ['x'], { alternate: true }),
];
const config = (over: Partial<AreasConfig> = {}): AreasConfig => ({
  utility: ['WATER'],
  areas: [
    { id: 'ore', name: 'Ore', rule: 'raw', items: [] },
    { id: 'steel', name: 'Steel', signature: ['ORE', 'COAL'], items: [] },
    { id: 'parts', name: 'Parts', items: ['PLATE'] },
    { id: 'other', name: 'Other', rule: 'fallback', items: [] },
    { id: 'final', name: 'Final', rule: 'targets', items: [] },
  ],
  ...over,
});

describe('simplestRoutes', () => {
  const routes = simplestRoutes(items, recipes);
  test('takes the route with the fewest raw resources', () => {
    expect(routes.get('ingot')).toMatchObject({ signature: ['ore'], depth: 1, recipe: 'ingot' });
    expect(routes.get('frame')).toMatchObject({ signature: ['coal', 'ore', 'water'], depth: 4 });
  });
  test('uses an alternate only where no base route reaches', () => {
    expect(routes.get('x')).toMatchObject({ recipe: 'x', alternate: true, depth: 3 });
    expect(routes.has('lonely')).toBe(false);
  });
});

describe('buildAreas', () => {
  const place = (c = config()) => {
    const issues = new Issues();
    const r = buildAreas(c, items, recipes, issues);
    return { issues: issues.list, at: new Map(r?.items.map((i) => [i.item, i])) };
  };
  test('applies the rules in order: listed, raw, signature, closest family, fallback', () => {
    const { issues, at } = place();
    expect(issues).toEqual([]);
    expect(at.get('plate')).toMatchObject({ area: 'parts', reason: 'listed' });
    expect(at.get('ore')).toMatchObject({ area: 'ore', reason: 'raw' });
    expect(at.get('ingot')).toMatchObject({ area: 'ore', reason: 'raw' });
    // Ore and coal, water aside: the steel signature.
    expect(at.get('steel')).toMatchObject({ area: 'steel', reason: 'signature' });
    expect(at.get('beam')).toMatchObject({ area: 'steel', reason: 'signature' });
    expect(at.get('frame')).toMatchObject({ area: 'steel', reason: 'signature' });
    // Needs sand too, but shares ore with the only family: Parts.
    expect(at.get('gizmo')).toMatchObject({ area: 'parts', reason: 'nearest' });
    expect(at.get('lonely')).toMatchObject({ area: 'other', reason: 'fallback', depth: -1 });
  });
  test('a listed item wins over every rule', () => {
    const c = config();
    c.areas[2]!.items.push('ORE', 'STEEL');
    const { at } = place(c);
    expect(at.get('ore')?.area).toBe('parts');
    expect(at.get('steel')?.area).toBe('parts');
  });
  test('an unknown part, a part listed twice and a missing rule are errors', () => {
    const c = config();
    c.areas[2]!.items.push('NOPE');
    c.areas[1]!.items.push('PLATE');
    c.areas[3]!.rule = undefined;
    const codes = place(c).issues.map((i) => i.code);
    expect(codes).toEqual(['areas.rule', 'areas.twice', 'areas.unknownPart']);
  });
});

describe('real dataset (A62)', () => {
  const root = new URL('../../../', import.meta.url);
  const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
  let result: BuildResult;
  beforeAll(() => {
    result = buildModel({
      gameData: read('game_data.json'),
      nodesCsv: read('data/nodes.csv'),
      minerModel: read('data/miner-model.json'),
      overrides: read('data/overrides.json'),
      areas: read('data/areas.json'),
    });
  });
  const area = (id: string) => result.model!.items.find((i) => i.id === id)?.area;

  test('every solid and fluid item has a known area', () => {
    const ids = new Set(result.model!.areas!.map((a) => a.id));
    for (const i of result.model!.items)
      if (i.form === 'solid' || i.form === 'fluid') expect(ids, i.id).toContain(i.area);
      else expect(i.area).toBeUndefined();
  });
  test('raw resources and miner outputs are ore processing; families hold their parts', () => {
    expect(area('siterite-ore')).toBe('ore-processing');
    expect(area('water')).toBe('ore-processing');
    // A Modular Miner smelts it straight from the node.
    expect(area('iron-ingot')).toBe('ore-processing');
    expect(area('steel-beam')).toBe('steelworks');
    expect(area('circuit-board')).toBe('electronics');
    expect(area('motor')).toBe('motors');
    expect(area('plastic')).toBe('oil-refining');
    expect(area('reinforced-iron-plate')).toBe('structures');
  });
  test('the placement is deterministic', () => {
    expect(result.details!.areas).toEqual(
      buildModel({
        gameData: read('game_data.json'),
        nodesCsv: read('data/nodes.csv'),
        minerModel: read('data/miner-model.json'),
        overrides: read('data/overrides.json'),
        areas: read('data/areas.json'),
      }).details!.areas,
    );
  });
});
