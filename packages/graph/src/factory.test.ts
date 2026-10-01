import type { ItemRate, RecipeUsage } from '@sps/solver';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { allocate, factoryGraph, type FactoryGraph, type FlowchartInput } from './factory';

const SEED = 20261001;

const recipe = (
  id: string,
  machines: number,
  inputs: ItemRate[],
  outputs: ItemRate[],
  extra: Partial<RecipeUsage> = {},
): RecipeUsage => ({
  id,
  name: id,
  machine: `${id}-machine`,
  machines,
  machinesCeil: Math.ceil(machines),
  powerMW: 0,
  inputs,
  outputs,
  ...extra,
});

/** Totals per item from the recipes, plus imports, surplus and demand, as the solver reports them. */
function plan(
  recipes: RecipeUsage[],
  extra: { imports?: ItemRate[]; surplus?: ItemRate[]; demand?: ItemRate[] },
): FlowchartInput {
  const items = new Map<
    string,
    { produced: number; consumed: number; imported: number; surplus: number; demand: number }
  >();
  const get = (item: string) => {
    let f = items.get(item);
    if (!f) items.set(item, (f = { produced: 0, consumed: 0, imported: 0, surplus: 0, demand: 0 }));
    return f;
  };
  for (const r of recipes) {
    for (const f of r.outputs) get(f.item).produced += f.rate;
    for (const f of r.inputs) get(f.item).consumed += f.rate;
  }
  for (const f of extra.imports ?? []) get(f.item).imported += f.rate;
  for (const f of extra.surplus ?? []) get(f.item).surplus += f.rate;
  for (const f of extra.demand ?? []) get(f.item).demand += f.rate;
  return {
    status: 'ok',
    recipes,
    items: [...items].map(([item, f]) => ({ item, ...f })),
    imports: extra.imports ?? [],
    surplus: extra.surplus ?? [],
  };
}

/** Σ edge rate in and out of each node, per item, against the node's own flows. */
function expectConserved(g: FactoryGraph) {
  const sum = new Map<string, number>();
  const add = (k: string, v: number) => sum.set(k, (sum.get(k) ?? 0) + v);
  for (const e of g.edges) {
    add(`${e.source} out ${e.item}`, e.rate);
    add(`${e.target} in ${e.item}`, e.rate);
  }
  for (const n of g.nodes)
    for (const [side, flows] of [
      ['in', n.inputs],
      ['out', n.outputs],
    ] as const)
      for (const f of flows) {
        const got = sum.get(`${n.id} ${side} ${f.item}`) ?? 0;
        expect(Math.abs(got - f.rate), `${n.id} ${side} ${f.item}`).toBeLessThanOrEqual(
          1e-6 * Math.max(1, f.rate),
        );
      }
  // No edge carries an item its endpoints do not list.
  for (const e of g.edges) {
    const s = g.nodes.find((n) => n.id === e.source)!;
    const t = g.nodes.find((n) => n.id === e.target)!;
    expect(s.outputs.some((f) => f.item === e.item)).toBe(true);
    expect(t.inputs.some((f) => f.item === e.item)).toBe(true);
  }
}

// Iron plates with an imported part of the ingots, plus a coal heater making
// 20 Steam/min: one whole heater burns its full 15 Coal and emits 15 Flue Gas,
// the boiler runs at 50% (A17).
const sample = plan(
  [
    recipe('mine-iron', 1.5, [], [{ item: 'iron-ore', rate: 90 - 30 }], { node: 'iron:normal' }),
    recipe('iron-ingot', 2, [{ item: 'iron-ore', rate: 60 }], [{ item: 'iron-ingot', rate: 60 }]),
    recipe('iron-plate', 3, [{ item: 'iron-ingot', rate: 90 }], [{ item: 'iron-plate', rate: 60 }]),
    recipe('mine-coal', 0.25, [], [{ item: 'coal', rate: 15 }], { node: 'coal:normal' }),
    recipe('water', 10 / 120, [], [{ item: 'water', rate: 10 }]),
    recipe(
      'coal-heater',
      1,
      [
        { item: 'water', rate: 10 },
        { item: 'coal', rate: 15 },
      ],
      [
        { item: 'steam', rate: 20 },
        { item: 'flue-gas', rate: 15 },
      ],
      { boilerLoad: 0.5 },
    ),
  ],
  {
    imports: [{ item: 'iron-ingot', rate: 30 }],
    surplus: [{ item: 'flue-gas', rate: 15 }],
    demand: [
      { item: 'iron-plate', rate: 60 },
      { item: 'steam', rate: 20 },
    ],
  },
);

describe('factoryGraph', () => {
  test('one node per recipe, import, target and byproduct, in kind order', () => {
    const g = factoryGraph(sample, { item: (id) => id.toUpperCase() });
    expect(g.nodes.map((n) => `${n.kind} ${n.id}`)).toEqual([
      'import import:iron-ingot',
      'resource recipe:mine-coal',
      'resource recipe:mine-iron',
      'recipe recipe:coal-heater',
      'recipe recipe:iron-ingot',
      'recipe recipe:iron-plate',
      'recipe recipe:water',
      'target target:iron-plate',
      'target target:steam',
      'byproduct byproduct:flue-gas',
    ]);
    expect(g.nodes[0]!.label).toBe('IRON-INGOT');
    expect(g.edges.find((e) => e.item === 'steam')!.itemName).toBe('STEAM');
  });

  test('edge rates conserve at every node', () => {
    expectConserved(factoryGraph(sample));
  });

  test('heater edges carry whole-heater fuel and exhaust and the boiler side at its load', () => {
    const g = factoryGraph(sample);
    const edge = (item: string) => g.edges.filter((e) => e.item === item);
    expect(edge('coal')).toMatchObject([
      { source: 'recipe:mine-coal', target: 'recipe:coal-heater', rate: 15 },
    ]);
    expect(edge('flue-gas')).toMatchObject([
      { source: 'recipe:coal-heater', target: 'byproduct:flue-gas', rate: 15 },
    ]);
    expect(edge('water')).toMatchObject([{ rate: 10 }]);
    expect(edge('steam')).toMatchObject([{ target: 'target:steam', rate: 20 }]);
    const heater = g.nodes.find((n) => n.id === 'recipe:coal-heater')!;
    expect(heater).toMatchObject({ machines: 1, machinesCeil: 1, boilerLoad: 0.5 });
  });

  test('ingots from a recipe and an import both feed the plates', () => {
    const g = factoryGraph(sample);
    expect(g.edges.filter((e) => e.item === 'iron-ingot')).toMatchObject([
      { source: 'import:iron-ingot', target: 'recipe:iron-plate', rate: 30 },
      { source: 'recipe:iron-ingot', target: 'recipe:iron-plate', rate: 60 },
    ]);
  });

  test('the same item in and out of one recipe stays two flows (Hydrogen heater water)', () => {
    const p = plan(
      [
        recipe('water', 0.5, [], [{ item: 'water', rate: 60 }]),
        recipe(
          'h2-heater',
          1,
          [
            { item: 'water', rate: 75 },
            { item: 'hydrogen', rate: 60 },
          ],
          [
            { item: 'steam', rate: 150 },
            { item: 'water', rate: 15 },
          ],
          { boilerLoad: 1 },
        ),
      ],
      { imports: [{ item: 'hydrogen', rate: 60 }], demand: [{ item: 'steam', rate: 150 }] },
    );
    const g = factoryGraph(p);
    expectConserved(g);
    const heater = g.nodes.find((n) => n.id === 'recipe:h2-heater')!;
    expect(heater.inputs).toContainEqual({ item: 'water', rate: 75 });
    expect(heater.outputs).toContainEqual({ item: 'water', rate: 15 });
  });

  test('a converter loop conserves around the cycle', () => {
    // coal → larrussite → callanite → coal, fed by an imported catalyst.
    const p = plan(
      [
        recipe(
          'larrussite',
          1,
          [
            { item: 'sam', rate: 20 },
            { item: 'coal', rate: 160 },
          ],
          [{ item: 'larrussite', rate: 240 }],
        ),
        recipe(
          'callanite',
          0.8,
          [
            { item: 'sam', rate: 16 },
            { item: 'larrussite', rate: 240 },
          ],
          [{ item: 'callanite', rate: 192 }],
        ),
        recipe(
          'coal',
          192 / 180,
          [
            { item: 'sam', rate: (20 * 192) / 180 },
            { item: 'callanite', rate: 192 },
          ],
          [{ item: 'coal', rate: 256 }],
        ),
      ],
      {
        imports: [{ item: 'sam', rate: 36 + (20 * 192) / 180 }],
        demand: [{ item: 'coal', rate: 96 }],
      },
    );
    const g = factoryGraph(p);
    expectConserved(g);
    expect(g.edges.map((e) => `${e.source}→${e.target}`)).toContain(
      'recipe:coal→recipe:larrussite',
    );
  });

  test('order of the result lists does not change the graph', () => {
    const shuffled: FlowchartInput = {
      ...sample,
      recipes: [...sample.recipes].reverse(),
      items: [...sample.items].reverse(),
    };
    expect(factoryGraph(shuffled)).toEqual(factoryGraph(sample));
  });

  test('a plan that did not solve has no graph', () => {
    expect(factoryGraph({ ...sample, status: 'infeasible' })).toEqual({ nodes: [], edges: [] });
  });
});

describe('allocate (A24)', () => {
  const side = fc.array(fc.double({ min: 1e-6, max: 1e4, noNaN: true }), {
    minLength: 1,
    maxLength: 8,
  });

  test('every producer and consumer conserves, with at most P + C − 1 edges', () => {
    fc.assert(
      fc.property(side, side, fc.double({ min: -1e-7, max: 1e-7, noNaN: true }), (p, c, err) => {
        // Consumers take what producers make, up to a solver-sized residual.
        const supply = p.reduce((s, x) => s + x, 0);
        const scale = (supply / c.reduce((s, x) => s + x, 0)) * (1 + err);
        const producers = p.map((rate, k) => ({ node: `p${k}`, rate }));
        const consumers = c.map((x, k) => ({ node: `c${k}`, rate: x * scale }));
        const edges = allocate(producers, consumers);
        expect(edges.length).toBeLessThanOrEqual(p.length + c.length - 1);
        for (const e of edges) expect(e.rate).toBeGreaterThan(0);
        for (const [list, key] of [
          [producers, 'source'],
          [consumers, 'target'],
        ] as const)
          for (const n of list) {
            const got = edges.filter((e) => e[key] === n.node).reduce((s, e) => s + e.rate, 0);
            expect(Math.abs(got - n.rate)).toBeLessThanOrEqual(1e-6 * Math.max(1, n.rate));
          }
      }),
      { numRuns: 500, seed: SEED },
    );
  });

  test('nothing to split gives no edges', () => {
    expect(allocate([{ node: 'p', rate: 0 }], [{ node: 'c', rate: 0 }])).toEqual([]);
  });
});
