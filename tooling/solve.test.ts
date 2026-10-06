import type { Model } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { beforeAll, describe, expect, test } from 'vitest';
import { runPipeline } from './build-data';
import { loadVanillaMini } from './golden';
import { CliError, parseCli, renderPlan, runCli } from './solve';

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
      recipes: { alternates: false, exclude: [] },
    });
  });

  test('objective stacks, tolerance, whole machines, import costing and alternates', () => {
    const { request, compareAlternates } = parseCli(
      [
        '-t',
        'Cable:30',
        '-o',
        'types, O1,machines',
        '--tolerance',
        '0.5%',
        '--whole-machines',
        '--cost-imports',
        '--alternates',
        '--compare-alternates',
      ],
      mini,
    );
    expect(compareAlternates).toBe(true);
    expect(request).toMatchObject({
      objectives: ['resourceTypes', 'resources', 'machines'],
      tolerance: 0.005,
      wholeMachines: true,
      costImports: true,
      recipes: { alternates: true, exclude: [] },
    });
    expect(request.objective).toBeUndefined();
    expect(parseCli(['-t', 'Cable:30', '-o', 'o4'], mini).request.objective).toBe('power');
  });

  test('--min-branch sets the prune threshold in machines', () => {
    expect(parseCli(['-t', 'Cable:30', '--min-branch', '0.05'], mini).request.minBranch).toBe(0.05);
    expect(parseCli(['-t', 'Cable:30'], mini).request.minBranch).toBeUndefined();
    expect(() => parseCli(['-t', 'Cable:30', '--min-branch=-1'], mini)).toThrow(
      '--min-branch: "-1" is not a rate ≥ 0.',
    );
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

  test('--enable turns on single alternates and --max-tier sets the tier limit', () => {
    const { request } = parseCli(
      ['-t', 'Screw:40', '--enable', 'cast-screw', '--max-tier', '3-2'],
      mini,
    );
    expect(request.recipes).toEqual({
      alternates: false,
      exclude: [],
      include: ['cast-screw'],
      maxTier: '3-2',
    });
  });

  test.each([
    [[], 'At least one --target is required.'],
    [['-t', 'Cable:1', '--enable', 'nope'], 'Unknown recipe id "nope" in --enable.'],
    [['-t', 'Cable:1', '--max-tier', '3'], '--max-tier "3" must look like 3-2 (major-minor).'],
    [['-t', 'Iron Plate'], '--target "Iron Plate" needs a rate, like "Iron Plate:60".'],
    [['-t', 'Iron Plate:-3'], '--target "Iron Plate:-3": "-3" is not a rate ≥ 0.'],
    [
      ['-t', 'Iron Plat:60'],
      'Unknown item "Iron Plat". Did you mean: Iron Plate, Reinforced Iron Plate?',
    ],
    [
      ['-t', 'Cable:1', '-o', 'resources,nope'],
      'Unknown --objective "nope" (resources, scarcity, machines, power, output or types).',
    ],
    [
      ['-t', 'Cable:1', '--tolerance', 'lots'],
      '--tolerance "lots" must be a percentage, like 0.5%.',
    ],
    [
      ['-t', 'Cable:1', '--alternates', '--no-alternates'],
      '--alternates and --no-alternates contradict each other.',
    ],
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

  test('an objective stack prints each stage', async () => {
    const { code, stdout } = await runCli([
      '--model',
      MINI,
      '-t',
      'Cable:30',
      '--alternates',
      '-o',
      'resources,scarcity',
      '--tolerance',
      '20%',
    ]);
    expect(code).toBe(0);
    expect(stdout.split('\n').slice(0, 3)).toEqual([
      'Status: ok    Objectives: resources > scarcity',
      '  resources = 0.556 (optimum 0.5)',
      '  scarcity = 0.014 (optimum 0.014)',
    ]);
    expect(stdout).toContain('Iron Wire');
  });

  test('out-of-range tolerance is rejected by the solver', async () => {
    const { code, stdout } = await runCli(['--model', MINI, '-t', 'Cable:30', '--tolerance', '95']);
    expect(code).toBe(1);
    expect(stdout).toContain('Tolerance must be between 0.01% and 90% (got 95%).');
  });

  test('--cost-imports prints the embodied cost; -o output prints the scale', async () => {
    const costed = await runCli([
      '--model',
      MINI,
      '-t',
      'Iron Plate:60',
      '-i',
      'Iron Ingot',
      '--cost-imports',
    ]);
    expect(costed.stdout).toContain(
      'Import costs (per 1/min at the imported rate, standalone plan)\n' +
        'Item        Resource types  At /min  resources\n' +
        '----------  --------------  -------  ---------\n' +
        'Iron Ingot  Iron Ore             90      0.017',
    );
    const scaled = await runCli([
      '--model',
      MINI,
      '-t',
      'Iron Plate:20',
      '-i',
      'Iron Ingot:90',
      '-o',
      'output',
      '--budget',
      'node:iron-ore:normal=0',
    ]);
    expect(scaled.stdout).toContain('Output scale: 3 × the targets');
  });

  test('--compare-alternates lists the alternates that help', async () => {
    const { code, stdout } = await runCli([
      '--model',
      MINI,
      '-t',
      'Screw:40',
      '-o',
      'resources,power',
      '--compare-alternates',
    ]);
    expect(code).toBe(0);
    expect(stdout.split('\n').slice(0, 7)).toEqual([
      'Alternates that help: Alternate: Cast Screw',
      '',
      'Objective  Without   With',
      '---------  -------  -----',
      'resources    0.167  0.167',
      'power        8.833  5.367',
      '',
    ]);
    expect(stdout).toContain('Plan with alternates');
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

  test('Steam 20/min: one whole heater burns full fuel, the table shows its boiler load (A17)', async () => {
    const r = await solve(model, { targets: [{ item: 'steam', rate: 20 }] }, createHighsBackend());
    expect(r.status).toBe('ok');
    const heaters = r.recipes.filter((x) => x.boilerLoad !== undefined);
    expect(heaters).toHaveLength(1);
    expect(heaters[0]!.machines).toBe(1);
    const text = renderPlan(model, r);
    expect(text).toMatch(/Count\s+Build\s+Boiler\s+MW/);
    expect(text).toMatch(/Heater.*\s1\s+1\s+20%\s/);
    expect(r.surplus.find((s) => s.item === 'steam')).toBeUndefined();
  });

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

  test('2000 MW from Coal: a valid fuel chain', async () => {
    const otherGenerators = model.recipes
      .filter((r) => r.kind === 'generator' && !r.inputs.some((f) => f.item === 'coal'))
      .map((r) => r.id);
    const r = await solve(
      model,
      { targets: [{ item: 'mw', rate: 2000 }], recipes: { exclude: otherGenerators } },
      createHighsBackend(),
    );
    expect(r.status).toBe('ok');
    const generators = r.recipes.filter(
      (x) => model.recipes.find((m) => m.id === x.id)!.kind === 'generator',
    );
    expect(generators.map((g) => g.id)).toEqual(['coal-coal-generator']);
    expect(r.power.generationMW).toBeCloseTo(2000, 6);
    // Coal and water reach the generators: both are produced in the plan, nothing imported.
    const flow = (item: string) => r.items.find((i) => i.item === item)!;
    expect(flow('coal').produced).toBeGreaterThan(0);
    expect(flow('water').produced).toBeGreaterThan(0);
    expect(r.imports).toEqual([]);
    expect(flow('mw')).toMatchObject({ produced: expect.closeTo(2000, 6), demand: 2000 });
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
