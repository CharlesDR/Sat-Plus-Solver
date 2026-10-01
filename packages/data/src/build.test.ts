import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildModel, type BuildInputs, type BuildResult } from './build';
import { MW_ITEM_ID, type Model } from './model';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const inputs: BuildInputs = {
  gameData: read('game_data.json'),
  nodesCsv: read('data/nodes.csv'),
  minerModel: read('data/miner-model.json'),
  overrides: read('data/overrides.json'),
};

const errorsOf = (r: BuildResult) => r.issues.filter((i) => i.severity === 'error');

let result: BuildResult;
let model: Model;
beforeAll(() => {
  result = buildModel(inputs);
  model = result.model!;
});
const recipe = (id: string) => {
  const r = model.recipes.find((x) => x.id === id);
  if (!r) throw new Error(`no recipe ${id}`);
  return r;
};

describe('real dataset', () => {
  test('builds with no errors', () => {
    expect(errorsOf(result)).toEqual([]);
    expect(model).toBeDefined();
  });

  test('generated miner routes match every dataset Modular Miner row at zero boosters', () => {
    const cc = result.details!.extraction.crossCheck;
    expect(cc.checked).toBeGreaterThan(370);
    expect(cc.mismatches.filter((m) => !m.whitelisted)).toEqual([]);
  });

  test('Iron Plate: 30 Iron Ingot in, 20 Iron Plate out, 4 MW', () => {
    const r = recipe('iron-plate');
    expect(r.inputs).toEqual([{ item: 'iron-ingot', rate: 30 }]);
    expect(r.outputs).toEqual([{ item: 'iron-plate', rate: 20 }]);
    expect(r.powerMW).toBe(4);
    expect(r.machine).toBe('constructor');
  });

  test('Coal generator outputs MW equal to its machine generation', () => {
    const r = recipe('coal-coal-generator');
    const machine = model.machines.find((m) => m.id === r.machine)!;
    expect(r.kind).toBe('generator');
    expect(r.outputs).toEqual([{ item: MW_ITEM_ID, rate: 200 }]);
    expect(r.powerMW).toBe(-200);
    expect(machine.powerMW).toBe(-200);
  });

  test('pure Montanion, Mk.3, Slug Slime, full boosters → 1800/min = 900 per belt', () => {
    const r = recipe('mine:montanion-ore:pure:raw:slug-slime');
    const beltOutputs = (JSON.parse(inputs.minerModel) as { modularMiner: { beltOutputs: number } })
      .modularMiner.beltOutputs;
    expect(r.outputs).toEqual([{ item: 'montanion-ore', rate: 1800 }]);
    expect(r.outputs[0]!.rate / beltOutputs).toBe(900);
    expect(r.inputs).toEqual([{ item: 'slug-slime', rate: 30 }]);
    expect(r.node).toBe('node:montanion-ore:pure');
  });

  test('fracking sites use the Nitrogen benchmark (40/3 NNE × 45 × 2.5 = 1500 m³/min)', () => {
    for (const id of [
      'extract:nitrogen-gas:site',
      'extract:chlorine-gas:site',
      'extract:crude-oil:site',
    ]) {
      expect(recipe(id).outputs[0]!.rate).toBeCloseTo(1500, 9);
    }
  });

  test('model invariants: unique ids, known references, positive rates', () => {
    const items = new Set(model.items.map((i) => i.id));
    const machines = new Set(model.machines.map((m) => m.id));
    const nodes = new Set(model.nodes.map((n) => n.id));
    expect(new Set(model.recipes.map((r) => r.id)).size).toBe(model.recipes.length);
    for (const r of model.recipes) {
      expect(machines.has(r.machine)).toBe(true);
      expect(r.outputs.length).toBeGreaterThan(0);
      for (const f of [...r.inputs, ...r.outputs]) {
        expect(items.has(f.item)).toBe(true);
        expect(f.rate).toBeGreaterThan(0);
        expect(Number.isFinite(f.rate)).toBe(true);
      }
      if (r.node) expect(nodes.has(r.node)).toBe(true);
      expect(Number.isFinite(r.powerMW)).toBe(true);
    }
    // Every node class can be extracted.
    for (const n of model.nodes) expect(model.recipes.some((r) => r.node === n.id)).toBe(true);
  });

  test('Solid Fuel Heater Mk.1 (Coal): heater side 15 Coal → 15 Flue Gas; boiler 20 Water → 40 Steam (A17)', () => {
    const r = model.recipes.find((x) => x.name === 'Solid Fuel Heater Mk.1 (Coal)')!;
    expect(r.heater).toBe(true);
    expect(r.kind).toBe('production');
    expect(r.inputs).toEqual([
      { item: 'water', rate: 20 },
      { item: 'coal', rate: 15, heater: true },
    ]);
    expect(r.outputs).toEqual([
      { item: 'steam', rate: 40 },
      { item: 'flue-gas', rate: 15, heater: true },
    ]);
  });

  test('Hydrogen heater keeps boiler Water and exhaust Water apart (A17)', () => {
    const r = model.recipes.find((x) => x.name === 'Solution Heater Mk.1 (Hydrogen)')!;
    expect(r.inputs).toEqual([
      { item: 'water', rate: 50 },
      { item: 'hydrogen', rate: 60, heater: true },
    ]);
    expect(r.outputs).toEqual([
      { item: 'steam', rate: 100 },
      { item: 'water', rate: 15, heater: true },
    ]);
  });

  test('every heater recipe has one boiler pair and a fuel; nothing else is marked (A17)', () => {
    const heaters = model.recipes.filter((r) => r.heater);
    expect(heaters).toHaveLength(96);
    for (const r of heaters) {
      expect(r.inputs.filter((f) => !f.heater)).toHaveLength(1);
      expect(r.outputs.filter((f) => !f.heater)).toHaveLength(1);
      expect(r.inputs.filter((f) => f.heater).length).toBeGreaterThan(0);
    }
    for (const r of model.recipes.filter((x) => !x.heater))
      for (const f of [...r.inputs, ...r.outputs]) expect(f.heater).toBeUndefined();
  });

  test('is deterministic', () => {
    expect(buildModel(inputs).model).toEqual(model);
  });
});

describe('invalid inputs fail the build with a clear message', () => {
  const expectError = (mutated: Partial<BuildInputs>, code: string, text: RegExp) => {
    const r = buildModel({ ...inputs, ...mutated });
    expect(r.model).toBeUndefined();
    const errors = errorsOf(r);
    expect(errors.map((e) => e.code)).toContain(code);
    expect(errors.find((e) => e.code === code)!.message).toMatch(text);
  };

  test('unparseable amount', () => {
    const data = JSON.parse(inputs.gameData) as {
      Recipes: { Name: string; Parts: { Amount: string }[] }[];
    };
    data.Recipes.find((r) => r.Name === 'Iron Plate')!.Parts[1]!.Amount = 'two';
    expectError({ gameData: JSON.stringify(data) }, 'number', /Iron Plate.*cannot parse "two"/);
  });

  test('unknown part', () => {
    const data = JSON.parse(inputs.gameData) as {
      Recipes: { Name: string; Parts: { Part: string }[] }[];
    };
    data.Recipes.find((r) => r.Name === 'Iron Plate')!.Parts[0]!.Part = 'Unobtainium Ingot';
    expectError(
      { gameData: JSON.stringify(data) },
      'recipe.unknownPart',
      /unknown part "Unobtainium Ingot"/,
    );
  });

  test('node resource that is not a part', () => {
    expectError(
      { nodesCsv: `${inputs.nodesCsv}Unobtainium,0,1,0,0,\n` },
      'nodes.unknownResource',
      /"Unobtainium"/,
    );
  });

  test('node resource with no extraction route', () => {
    // Iron Ingot is a part but nothing extracts it from a node.
    expectError(
      { nodesCsv: `${inputs.nodesCsv}Iron Ingot,0,1,0,0,\n` },
      'nodes.uncovered',
      /Iron Ingot/,
    );
  });

  test('Modular Miner row with an unmapped ore prefix', () => {
    const overrides = JSON.parse(inputs.overrides) as { minerOres: Record<string, string> };
    delete overrides.minerOres.Siterite;
    expectError({ overrides: JSON.stringify(overrides) }, 'miner.ore', /prefix "Siterite"/);
  });

  test('dataset row that disagrees with the miner rate model', () => {
    const data = JSON.parse(inputs.gameData) as {
      Recipes: { Name: string; Parts: { Part: string; Amount: string }[] }[];
    };
    const row = data.Recipes.find(
      (r) => r.Name === 'Sulfur Powder / Water - pure Mk.2 (MM Fluid/Crusher Module)',
    )!;
    row.Parts.find((p) => p.Part === 'Crushed Gangue')!.Amount = '91';
    expectError(
      { gameData: JSON.stringify(data) },
      'miner.crossCheck',
      /Sulfur Powder \/ Water - pure Mk\.2/,
    );
  });

  test('fluid rates that look like litres', () => {
    const data = JSON.parse(inputs.gameData) as {
      Recipes: { Name: string; Parts: { Amount: string }[] }[];
    };
    data.Recipes.find((r) => r.Name === 'Water')!.Parts[0]!.Amount = '180000';
    expectError({ gameData: JSON.stringify(data) }, 'units.fluid', /litres/);
  });

  test('heater machine missing from overrides.heaterMachines (A17)', () => {
    const overrides = JSON.parse(inputs.overrides) as { heaterMachines: Record<string, string> };
    delete overrides.heaterMachines['Solid Fuel Heater Mk.1 (MP)'];
    expectError(
      { overrides: JSON.stringify(overrides) },
      'heater.unclassified',
      /Solid Fuel Heater Mk\.1 \(MP\)/,
    );
  });

  test('heater recipe whose boiler pair is off ratio (A17)', () => {
    const data = JSON.parse(inputs.gameData) as {
      Recipes: { Name: string; Parts: { Part: string; Amount: string }[] }[];
    };
    const row = data.Recipes.find((r) => r.Name === 'Solid Fuel Heater Mk.1 (Coal)')!;
    row.Parts.find((p) => p.Part === 'Steam')!.Amount = '30';
    expectError({ gameData: JSON.stringify(data) }, 'heater.ratio', /Coal.*expected 2/);
  });

  test('heater recipe with no boiler pair (A17)', () => {
    const data = JSON.parse(inputs.gameData) as {
      Recipes: { Name: string; Parts: { Part: string; Amount: string }[] }[];
    };
    const row = data.Recipes.find((r) => r.Name === 'Solid Fuel Heater Mk.1 (Coal)')!;
    row.Parts = row.Parts.filter((p) => p.Part !== 'Steam');
    expectError({ gameData: JSON.stringify(data) }, 'heater.boilerPair', /found 0/);
  });

  test('invalid JSON and schema violations', () => {
    expectError({ overrides: '{ nope' }, 'json', /data\/overrides\.json/);
    expectError({ gameData: '{"Machines": []}' }, 'schema', /game_data\.json/);
  });
});
