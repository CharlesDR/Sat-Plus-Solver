import type { Model } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { beforeAll, describe, expect, test } from 'vitest';
import { runPipeline } from './build-data';
import { loadVanillaMini } from './golden';
import { CliError, parseCli, runCli } from './solve';

const MINI = 'fixtures/vanilla-mini/model.json';
const mini = loadVanillaMini();

describe('pnpm solve: arguments', () => {
  test('targets and imports by name or id, objective aliases, unlimited imports', () => {
    const { request, json } = parseCli(
      [
        '--target',
        'iron plate:60',
        '-t',
        'cable:7.5',
        '--import',
        'Iron Ingot:30',
        '--import',
        'Copper Ingot',
        '--import',
        'wire:inf',
        '--objective',
        'O2',
        '--json',
      ],
      mini,
    );
    expect(json).toBe(true);
    expect(request).toEqual({
      targets: [
        { item: 'iron-plate', rate: 60 },
        { item: 'cable', rate: 7.5 },
      ],
      imports: [
        { item: 'iron-ingot', cap: 30 },
        { item: 'copper-ingot', cap: Infinity },
        { item: 'wire', cap: Infinity },
      ],
      objective: 'scarcity',
      nodeBudget: 'pool',
      recipes: { alternates: true, exclude: [] },
    });
  });

  test('--no-alternates, --exclude and --budget', () => {
    const { request } = parseCli(
      [
        '-t',
        'Screw:40',
        '--no-alternates',
        '--exclude',
        'cast-screw',
        '--budget',
        'node:iron-ore:normal=2',
      ],
      mini,
    );
    expect(request.recipes).toEqual({ alternates: false, exclude: ['cast-screw'] });
    expect(request.nodeBudget).toEqual({
      'node:iron-ore:normal': 2,
      'node:copper-ore:normal': 10,
      'node:limestone:normal': 20,
      'node:coal:normal': 10,
      'node:crude-oil:normal': 5,
    });
  });

  test.each([
    [[], 'At least one --target is required.'],
    [['-t', 'Iron Plate'], '--target "Iron Plate" needs a rate, like "Iron Plate:60".'],
    [['-t', 'Iron Plate:-3'], '--target "Iron Plate:-3": "-3" is not a rate ≥ 0.'],
    [
      ['-t', 'Iron Plat:60'],
      'Unknown item "Iron Plat". Did you mean: Iron Plate, Reinforced Iron Plate?',
    ],
    [['-t', 'Cable:1', '-o', 'power'], 'Unknown --objective "power" (resources or scarcity).'],
    [['-t', 'Cable:1', '--exclude', 'nope'], 'Unknown recipe id "nope" in --exclude.'],
    [
      ['-t', 'Cable:1', '--budget', 'node:x=1'],
      '--budget "node:x=1" must be "<node-id>=<count>" with a known node id.',
    ],
    [['-t', 'Cable:1', '--frobnicate'], "Unknown option '--frobnicate'"],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCli(argv, mini)).toThrow(CliError);
    expect(() => parseCli(argv, mini)).toThrow(message);
  });
});

describe('pnpm solve: output', () => {
  test('prints the plan table for Iron Plate 60/min', async () => {
    const { code, stdout } = await runCli(['--model', MINI, '--target', 'Iron Plate:60']);
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        'Status: ok    Objective: resources = 1.5',
        '',
        'Recipes',
        'Recipe             Machine      Count  Build   MW',
        '-----------------  -----------  -----  -----  ---',
        'Iron Ingot         Smelter          3      3   12',
        'Iron Plate         Constructor      3      3   12',
        'Iron Ore (normal)  Miner Mk.1     1.5      2  7.5',
        '',
        'Targets',
        'Item        Per min',
        '----------  -------',
        'Iron Plate       60',
        '',
        'Nodes',
        'Node               Used  Budget  NNE',
        '-----------------  ----  ------  ---',
        'Iron Ore (normal)   1.5      40  1.5',
        '',
        'Power: 31.5 MW draw, 0 MW generated, net 31.5 MW',
        '',
      ].join('\n'),
    );
  });

  test('shows imports and byproducts', async () => {
    const { stdout } = await runCli([
      '--model',
      MINI,
      '-t',
      'Plastic:20',
      '-t',
      'Iron Plate:20',
      '-i',
      'Iron Ingot:30',
    ]);
    expect(stdout).toContain(
      'Imports\nItem        Per min\n----------  -------\nIron Ingot       30',
    );
    expect(stdout).toContain(
      'Surplus and byproducts\nItem               Per min\n-----------------  -------\nHeavy Oil Residue       10',
    );
  });

  test('a diagnostic exits 1, a usage error exits 2', async () => {
    const bad = await runCli([
      '--model',
      MINI,
      '-t',
      'Iron Plate:60',
      '--budget',
      'node:iron-ore:normal=1',
    ]);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toBe(
      'Status: infeasible    Objective: resources\nerror: Infeasible: needs 0.5 more normal Iron Ore nodes.\n',
    );
    const usage = await runCli(['--model', MINI]);
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain('Usage: pnpm solve');
  });

  test('--json prints the SolveResult', async () => {
    const { stdout } = await runCli(['--model', MINI, '-t', 'Iron Plate:60', '--json']);
    const result = JSON.parse(stdout);
    expect(result.status).toBe('ok');
    expect(result.recipes.map((r: { id: string }) => r.id)).toEqual([
      'iron-ingot',
      'iron-plate',
      'mine-iron-ore',
    ]);
  });
});

describe('full SF+ model', () => {
  let model: Model;
  beforeAll(async () => {
    const { result } = await runPipeline();
    model = result.model!;
  }, 120_000);

  test('5 targets solve in under 1 s, including loading HiGHS', async () => {
    const start = performance.now();
    const r = await solve(
      model,
      {
        targets: [
          { item: 'computer', rate: 5 },
          { item: 'heavy-modular-frame', rate: 2 },
          { item: 'motor', rate: 5 },
          { item: 'plastic', rate: 60 },
          { item: 'steel-beam', rate: 30 },
        ],
      },
      createHighsBackend(),
    );
    const ms = performance.now() - start;
    expect(r.status).toBe('ok');
    expect(ms).toBeLessThan(1000);
  });

  test('every item with a dataset recipe and no inputs can be targeted alone', async () => {
    // Smoke test over the real data: a target per extracted resource solves or reports a diagnostic.
    const backend = createHighsBackend();
    const raws = [
      ...new Set(
        model.recipes.filter((r) => !r.inputs.length).flatMap((r) => r.outputs.map((f) => f.item)),
      ),
    ].sort();
    for (const item of raws) {
      const r = await solve(model, { targets: [{ item, rate: 10 }] }, backend);
      expect([item, r.status]).toEqual([item, 'ok']);
    }
  }, 60_000);
});
