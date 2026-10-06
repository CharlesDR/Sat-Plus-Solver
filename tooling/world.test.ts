import type { Model } from '@sps/data';
import { createHighsBackend, solve, type SolveRequest } from '@sps/solver';
import {
  createFactory,
  createWorld,
  resolveWorld,
  sizePowerPlant,
  type Link,
  type World,
} from '@sps/world';
import { beforeAll, describe, expect, test } from 'vitest';
import { runPipeline } from './build-data';
import { runWorldCli } from './world';

const MINI = 'fixtures/vanilla-mini/model.json';
const MINI_WORLD = 'fixtures/worlds/mini-world.json';

describe('pnpm world solve', () => {
  test('prints the factory, link, ledger, power and node tables', async () => {
    const { code, stdout, stderr } = await runWorldCli(['solve', MINI_WORLD, '--model', MINI]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    for (const title of ['Factories', 'Links', 'Item ledger', 'Groups', 'Nodes'])
      expect(stdout).toMatch(new RegExp(`^${title}`, 'm'));
    expect(stdout).toMatch(/Plate Works\s+Base\s+ok\s+Reinforced Iron Plate 5/);
    expect(stdout).toMatch(
      /ingots\s+Smelter\s+Plate Works\s+Iron Ingot\s+pull\s+60\s+60\s+60\s+0\s+belt Mk1 ×1/,
    );
    expect(stdout).toMatch(/^Power: 52\.75 MW draw, 75 MW generated, net -22\.25 MW$/m);
    expect(stdout).toMatch(/Iron Ore \(normal\)\s+40\s+1\s+Smelter 1/);
  });

  test('--json prints the world result', async () => {
    const { code, stdout } = await runWorldCli(['solve', MINI_WORLD, '--model', MINI, '--json']);
    expect(code).toBe(0);
    const r = JSON.parse(stdout) as { factories: { id: string }[]; power: { netMW: number } };
    expect(r.factories.map((f) => f.id)).toEqual(['plates', 'power', 'smelter']);
    expect(r.power.netMW).toBeCloseTo(-22.25, 9);
  });

  test('migrates an old save before solving', async () => {
    const { code, stdout } = await runWorldCli([
      'solve',
      'fixtures/worlds/v1-world.json',
      '--model',
      MINI,
    ]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Factory\s+ok\s+Iron Plate 60/);
  });

  test('usage errors exit 2', async () => {
    expect((await runWorldCli(['solve'])).code).toBe(2);
    expect((await runWorldCli(['run', MINI_WORLD])).code).toBe(2);
    const missing = await runWorldCli(['solve', 'nope.json', '--model', MINI]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/World file not found: nope\.json/);
  });
});

describe('full SF+ model', () => {
  let model: Model;
  const backend = createHighsBackend();
  const solveFactory = (r: SolveRequest) => solve(model, r, backend);
  beforeAll(async () => {
    const { result } = await runPipeline();
    model = result.model!;
  }, 120_000);

  /**
   * Every generator, heater and other steam source except a Mk.1 coal heater
   * and a Mk.1 HV steam turbine, so power comes from whole heaters.
   */
  const coalSteamOnly = () =>
    model.recipes
      .filter(
        (r) =>
          (r.kind === 'generator' || r.heater || r.outputs.some((f) => f.item === 'steam')) &&
          r.id !== 'solid-fuel-heater-mk-1-coal' &&
          r.id !== 'turbine-mk-1-hv-generator-steam',
      )
      .map((r) => r.id);

  function world(
    factories: {
      id: string;
      targets?: { item: string; rate: number }[];
      exclude?: string[];
      costImports?: boolean;
    }[],
    links: Link[] = [],
  ): World {
    const w = createWorld(model.meta.dataHash);
    w.factories = factories.map((s) => {
      const f = createFactory(s.id, s.id);
      f.request = {
        targets: s.targets ?? [],
        ...(s.exclude ? { recipes: Object.fromEntries(s.exclude.map((id) => [id, false])) } : {}),
        ...(s.costImports ? { costImports: true } : {}),
      };
      return f;
    });
    w.links = links;
    return w;
  }

  test('the example world resolves without errors', async () => {
    const { code, stdout, stderr } = await runWorldCli(['solve', 'examples/world.json']);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toMatch(/^Factories/m);
  }, 60_000);

  test('"size power plant" with a heater plant: exact MW, fuel for whole heaters (A17)', async () => {
    const w = world([
      { id: 'plant', exclude: coalSteamOnly() },
      { id: 'steel', targets: [{ item: 'steel-beam', rate: 2 }], exclude: coalSteamOnly() },
    ]);
    const before = await resolveWorld(w, model, solveFactory);
    expect(before.power.deficitMW).toBeGreaterThan(0);
    const sized = await sizePowerPlant(w, model, solveFactory, 'plant');
    expect(sized.result.power.netMW).toBeCloseTo(0, 6);
    const plant = sized.result.factories.find((f) => f.id === 'plant')!;
    expect(plant.status).toBe('ok');
    const target = sized.world.factories.find((f) => f.id === 'plant')!.request.targets[0]!;
    expect(plant.power.generationMW).toBeCloseTo(target.rate, 6);
    // Whole heaters burn full fuel; only the boiler side throttles.
    const heater = plant.result.recipes.find((r) => r.id === 'solid-fuel-heater-mk-1-coal')!;
    expect(Number.isInteger(heater.machines)).toBe(true);
    expect(heater.boilerLoad).toBeGreaterThan(0);
    expect(heater.boilerLoad).toBeLessThanOrEqual(1);
    const burned = plant.result.recipes
      .filter((r) => r.id === 'solid-fuel-heater-mk-1-coal')
      .reduce((s, r) => s + r.machines * 15, 0);
    const coal = plant.result.items.find((i) => i.item === 'coal')!;
    expect(coal.consumed).toBeCloseTo(burned, 6);
    const steam = plant.result.items.find((i) => i.item === 'steam')!;
    expect(steam.produced).toBeCloseTo(heater.machines * 40 * heater.boilerLoad!, 6);
  }, 60_000);

  test('a linked heater’s spare boiler capacity is free at the margin (A18)', async () => {
    // The turbine factory pulls 20 steam/min: half a coal heater's boiler.
    const w = world(
      [
        { id: 'boilers', exclude: coalSteamOnly() },
        {
          id: 'turbines',
          targets: [{ item: 'mw', rate: 100 }],
          exclude: [...coalSteamOnly(), 'solid-fuel-heater-mk-1-coal'],
          costImports: true,
        },
      ],
      [{ id: 'steam', from: 'boilers', to: 'turbines', item: 'steam', mode: { kind: 'pull' } }],
    );
    // The costs below are O1's; the default stack is O2.
    w.defaults.objectives = ['resources'];
    const r = await resolveWorld(w, model, solveFactory);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.links[0]!.requested).toBeCloseTo(20, 6);
    const boilers = r.factories.find((f) => f.id === 'boilers')!;
    const heater = boilers.result.recipes.find((x) => x.id === 'solid-fuel-heater-mk-1-coal')!;
    expect(heater.machines).toBe(1);
    expect(heater.boilerLoad).toBeLessThan(1);
    // The heater's fuel stays on the boiler factory: more steam only needs water.
    const quote = boilers.result.marginalCosts!.find((c) => c.item === 'steam')!;
    expect(quote.cost.resources).toBe(0);
    const turbines = r.factories.find((f) => f.id === 'turbines')!;
    expect(turbines.request.importCosts?.[0]).toMatchObject({
      item: 'steam',
      cost: { resources: 0 },
    });
  }, 60_000);

  test('a 30-factory world cold-solves in under 5 s, heater plants included', async () => {
    const products = [
      'iron-plate',
      'reinforced-iron-plate',
      'modular-frame',
      'steel-beam',
      'screws',
      'wire',
      'cable',
      'concrete',
      'iron-rod',
      'copper-sheet',
    ];
    const factories: Parameters<typeof world>[0] = [];
    const links: Link[] = [];
    // Eight chains of three (pull), each delivering a product.
    for (let c = 0; c < 8; c++) {
      const product = products[c % products.length]!;
      factories.push(
        { id: `c${c}-raw` },
        { id: `c${c}-mid` },
        { id: `c${c}-end`, targets: [{ item: product, rate: 10 + 5 * c }] },
      );
      links.push(
        {
          id: `c${c}-a`,
          from: `c${c}-raw`,
          to: `c${c}-mid`,
          item: 'iron-ingot',
          mode: { kind: 'pull' },
        },
        {
          id: `c${c}-b`,
          from: `c${c}-mid`,
          to: `c${c}-end`,
          item: 'iron-plate',
          mode: { kind: 'pull' },
        },
      );
    }
    // Four heater power plants and two standalone factories.
    for (let k = 0; k < 4; k++)
      factories.push({
        id: `power-${k}`,
        targets: [{ item: 'mw', rate: 150 + 70 * k }],
        exclude: coalSteamOnly(),
      });
    factories.push(
      { id: 'solo-a', targets: [{ item: 'motor', rate: 2 }] },
      { id: 'solo-b', targets: [{ item: 'plastic', rate: 30 }] },
    );
    expect(factories).toHaveLength(30);
    const w = world(factories, links);
    const start = performance.now();
    const r = await resolveWorld(w, model, solveFactory);
    const ms = performance.now() - start;
    expect(r.stats.solves + r.stats.cacheHits).toBe(30);
    expect(
      r.factories.filter((f) => f.status === 'infeasible').map((f) => [f.id, f.result.diagnostics]),
    ).toEqual([]);
    expect(ms).toBeLessThan(5000);
  }, 60_000);
});
