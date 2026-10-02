import type { Model } from '@sps/data';
import { createHighsBackend, solve, type SolveRequest } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import { createSolveCache } from './hash';
import { allocateRemaining, sizePowerPlant } from './helpers';
import { CYCLE_ITERATION_LIMIT, resolveWorld } from './resolve';
import { buildWorld, fixed, pull } from './testing';
import type { SolveFactory, WorldResult } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();

/** Counts calls and records each request's targets, so tests see which factory re-solved. */
function counting(): SolveFactory & { calls: SolveRequest[] } {
  const calls: SolveRequest[] = [];
  const f = (async (request: SolveRequest) => {
    calls.push(request);
    return solve(model, request, backend);
  }) as SolveFactory & { calls: SolveRequest[] };
  f.calls = calls;
  return f;
}
const solveFactory: SolveFactory = (r) => solve(model, r, backend);

const link = (r: WorldResult, id: string) => r.links.find((l) => l.id === id)!;
const factory = (r: WorldResult, id: string) => r.factories.find((f) => f.id === id)!;
const row = (rows: WorldResult['ledger'], item: string) => rows.find((x) => x.item === item);

describe('scenarios (§9 world scenarios)', () => {
  test('linear chain A → B → C (pull): demand propagates upstream', async () => {
    const world = buildWorld(
      [{ id: 'a' }, { id: 'b' }, { id: 'c', targets: [{ item: 'modular-frame', rate: 2 }] }],
      [pull('ab', 'a', 'b', 'iron-plate'), pull('bc', 'b', 'c', 'reinforced-iron-plate')],
    );
    const r = await resolveWorld(world, model, solveFactory);
    expect(r.diagnostics).toEqual([]);
    expect(link(r, 'bc')).toMatchObject({ requested: 3, delivered: 3, used: 3, short: 0 });
    // 3 RIP/min need 18 plates/min.
    expect(link(r, 'ab').requested).toBeCloseTo(18, 9);
    expect(factory(r, 'a').request.demand).toEqual([{ item: 'iron-plate', rate: 18 }]);
    expect(r.factories.map((f) => f.status)).toEqual(['ok', 'ok', 'ok']);
    // Save-wide: the frame target is delivered, nothing crosses the save's boundary.
    expect(row(r.ledger, 'modular-frame')).toMatchObject({ target: 2, imported: 0, exported: 0 });
    expect(row(r.ledger, 'iron-plate')).toMatchObject({ unmet: 0, surplus: 0 });
  });

  test('diamond: two branches pull from one producer, which sums their demand', async () => {
    const world = buildWorld(
      [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
        { id: 'd', targets: [{ item: 'reinforced-iron-plate', rate: 5 }] },
      ],
      [
        pull('ab', 'a', 'b', 'iron-ingot'),
        pull('ac', 'a', 'c', 'iron-ingot'),
        pull('bd', 'b', 'd', 'iron-plate'),
        pull('cd', 'c', 'd', 'screw'),
      ],
    );
    const r = await resolveWorld(world, model, solveFactory);
    expect(r.diagnostics).toEqual([]);
    expect(link(r, 'bd').requested).toBeCloseTo(30, 9);
    expect(link(r, 'cd').requested).toBeCloseTo(60, 9);
    expect(link(r, 'ab').requested).toBeCloseTo(45, 9);
    expect(link(r, 'ac').requested).toBeCloseTo(15, 9);
    expect(factory(r, 'a').request.demand).toEqual([{ item: 'iron-ingot', rate: 60 }]);
  });

  test('a two-factory pull cycle converges', async () => {
    // A makes RIP and pulls screws from B; B makes screws from A's ingots.
    const world = buildWorld(
      [{ id: 'a', targets: [{ item: 'reinforced-iron-plate', rate: 5 }] }, { id: 'b' }],
      [pull('ba', 'b', 'a', 'screw'), pull('ab', 'a', 'b', 'iron-ingot')],
    );
    const r = await resolveWorld(world, model, solveFactory);
    expect(r.diagnostics).toEqual([]);
    expect(link(r, 'ba').requested).toBeCloseTo(60, 9);
    expect(link(r, 'ab').requested).toBeCloseTo(15, 9);
    for (const l of r.links) expect(l.used).toBeCloseTo(l.requested, 9);
  });

  test('a non-convergent pull cycle is reported after the iteration limit', async () => {
    // Each side imports everything from the other: the pull rates grow every sweep.
    const world = buildWorld(
      [{ id: 'a', targets: [{ item: 'iron-plate', rate: 10 }] }, { id: 'b' }],
      [pull('ba', 'b', 'a', 'iron-plate'), pull('ab', 'a', 'b', 'iron-plate')],
    );
    const r = await resolveWorld(world, model, solveFactory);
    const d = r.diagnostics.find((x) => x.code === 'cycle-not-converged');
    expect(d).toMatchObject({
      severity: 'error',
      factories: ['a', 'b'],
      links: ['ab', 'ba'],
      iterations: CYCLE_ITERATION_LIMIT,
    });
    expect(d!.message).toMatch(/Make one of them fixed/);
  });

  test('an infeasible upstream marks its links short and the world still solves', async () => {
    const world = buildWorld(
      [
        { id: 'a', nodeBudget: {} },
        { id: 'b', targets: [{ item: 'reinforced-iron-plate', rate: 5 }] },
        { id: 'c', targets: [{ item: 'concrete', rate: 15 }] },
      ],
      [pull('ab', 'a', 'b', 'iron-plate'), fixed('ac', 'a', 'c', 'iron-rod', 10)],
    );
    const r = await resolveWorld(world, model, solveFactory);
    expect(factory(r, 'a').status).toBe('infeasible');
    expect(factory(r, 'b').status).toBe('short');
    expect(factory(r, 'c').status).toBe('ok');
    expect(link(r, 'ab')).toMatchObject({ requested: 30, delivered: 0, used: 30, short: 30 });
    expect(link(r, 'ac')).toMatchObject({ requested: 10, delivered: 0, short: 10 });
    expect(r.diagnostics.map((d) => d.code)).toEqual([
      'factory-failed',
      'link-short',
      'link-short',
    ]);
    expect(row(r.ledger, 'iron-plate')).toMatchObject({ unmet: 30 });
    // B's own plan still solved: it makes its screws.
    expect(row(factory(r, 'b').ledger, 'screw')?.produced).toBeCloseTo(60, 9);
  });

  test('node over-allocation is flagged, and "allocate remaining" sets the budget', async () => {
    // 40 normal iron nodes; each factory needs 30 (1800 ore/min).
    const world = buildWorld([
      { id: 'a', targets: [{ item: 'iron-plate', rate: 1200 }] },
      { id: 'b', targets: [{ item: 'iron-plate', rate: 1200 }] },
    ]);
    const r = await resolveWorld(world, model, solveFactory);
    const iron = r.nodePool.find((n) => n.node === 'node:iron-ore:normal')!;
    expect(iron).toMatchObject({ pool: 40, overAllocated: true });
    expect(iron.used).toBeCloseTo(60, 9);
    expect(iron.byFactory.map((u) => u.factory)).toEqual(['a', 'b']);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['node-over-allocated']);

    const edited = allocateRemaining(world, model, r, 'b');
    const budget = edited.factories.find((f) => f.id === 'b')!.nodeBudget as Record<string, number>;
    expect(budget['node:iron-ore:normal']).toBeCloseTo(10, 9);
    expect(budget['node:coal:normal']).toBe(10);
    const after = await resolveWorld(edited, model, solveFactory);
    expect(factory(after, 'b').status).toBe('infeasible');
    expect(after.nodePool.find((n) => n.node === 'node:iron-ore:normal')!.overAllocated).toBe(
      false,
    );
  });

  test('"size power plant" closes a power deficit', async () => {
    const world = buildWorld([
      { id: 'plant' },
      { id: 'steel', targets: [{ item: 'steel-beam', rate: 30 }] },
    ]);
    const before = await resolveWorld(world, model, solveFactory);
    expect(before.power.deficitMW).toBeGreaterThan(0);
    const sized = await sizePowerPlant(world, model, solveFactory, 'plant');
    expect(sized.result.power.netMW).toBeCloseTo(0, 6);
    expect(sized.result.power.deficitMW).toBeCloseTo(0, 6);
    // The plant covers the steel factory's draw and its own coal miners and pumps.
    const mw = sized.world.factories.find((f) => f.id === 'plant')!.request.targets[0]!;
    expect(mw.item).toBe('mw');
    expect(mw.rate).toBeGreaterThan(before.power.consumptionMW);
  });
});

describe('caching (§4.3 step 5)', () => {
  const world = () =>
    buildWorld(
      [
        { id: 'a' },
        { id: 'b' },
        { id: 'c', targets: [{ item: 'reinforced-iron-plate', rate: 5 }] },
        { id: 'e', targets: [{ item: 'concrete', rate: 30 }] },
        { id: 'x', targets: [{ item: 'cable', rate: 30 }] },
      ],
      [
        pull('ab', 'a', 'b', 'iron-ingot'),
        pull('bc', 'b', 'c', 'iron-plate'),
        fixed('ce', 'c', 'e', 'screw', 10),
      ],
    );

  test('editing one factory re-solves only it and its upstream pull dependents', async () => {
    const cache = createSolveCache();
    const cold = counting();
    const first = await resolveWorld(world(), model, cold, cache);
    expect(cold.calls).toHaveLength(5);

    const again = counting();
    await resolveWorld(world(), model, again, cache);
    expect(again.calls).toHaveLength(0);

    const edited = world();
    edited.factories.find((f) => f.id === 'c')!.request.targets = [
      { item: 'reinforced-iron-plate', rate: 10 },
    ];
    const warm = counting();
    const r = await resolveWorld(edited, model, warm, cache);
    expect(warm.calls).toHaveLength(3);
    expect(r.stats).toMatchObject({ solves: 3, cacheHits: 2 });
    const changed = r.factories
      .filter((f, k) => f.key !== first.factories[k]!.key)
      .map((f) => f.id);
    expect(changed).toEqual(['a', 'b', 'c']);
  });

  test('identical input gives identical output', async () => {
    const a = await resolveWorld(world(), model, solveFactory);
    const b = await resolveWorld(world(), model, solveFactory);
    expect(b).toEqual(a);
  });
});

describe('groups (§4.5)', () => {
  test('a group adds up its descendants; links inside it are internal', async () => {
    const world = buildWorld(
      [
        { id: 'a', group: 'inner' },
        { id: 'b', group: 'outer', targets: [{ item: 'reinforced-iron-plate', rate: 5 }] },
        { id: 'c', targets: [{ item: 'modular-frame', rate: 2 }] },
      ],
      [pull('ab', 'a', 'b', 'iron-plate'), pull('bc', 'b', 'c', 'reinforced-iron-plate')],
      [
        { id: 'outer', name: 'Outer', collapsed: true },
        { id: 'inner', name: 'Inner', parentId: 'outer', collapsed: false },
      ],
    );
    const r = await resolveWorld(world, model, solveFactory);
    const outer = r.groups.find((g) => g.id === 'outer')!;
    const inner = r.groups.find((g) => g.id === 'inner')!;
    expect(outer.factories).toEqual(['a', 'b']);
    expect(inner.factories).toEqual(['a']);
    expect(outer.internalLinks).toEqual(['ab']);
    expect(outer.boundaryLinks).toEqual(['bc']);
    const a = factory(r, 'a');
    const b = factory(r, 'b');
    expect(outer.power.consumptionMW).toBeCloseTo(a.power.consumptionMW + b.power.consumptionMW, 9);
    expect(outer.machines).toBe(a.machines + b.machines);
    // RIP leaves the group through bc; plates stay inside it.
    expect(row(outer.ledger, 'reinforced-iron-plate')).toMatchObject({ exported: 3 });
    expect(row(outer.ledger, 'iron-plate')).toMatchObject({ imported: 0, exported: 0 });
    expect(row(inner.ledger, 'iron-plate')!.exported).toBeCloseTo(48, 9);
  });

  test('unknown parents, parent cycles and unknown groups are reported, not fatal', async () => {
    const world = buildWorld(
      [{ id: 'a', group: 'nope', targets: [{ item: 'iron-plate', rate: 20 }] }],
      [],
      [
        { id: 'g1', name: 'G1', parentId: 'g2', collapsed: false },
        { id: 'g2', name: 'G2', parentId: 'g1', collapsed: false },
        { id: 'g3', name: 'G3', parentId: 'missing', collapsed: false },
      ],
    );
    const r = await resolveWorld(world, model, solveFactory);
    expect(r.diagnostics.map((d) => d.code)).toEqual([
      'invalid-group',
      'invalid-group',
      'invalid-group',
    ]);
    expect(r.groups.map((g) => [g.id, g.parentId])).toEqual([
      ['g1', undefined],
      ['g2', 'g1'],
      ['g3', undefined],
    ]);
  });
});

describe('links', () => {
  test('invalid links are ignored with a diagnostic', async () => {
    const world = buildWorld(
      [{ id: 'a', targets: [{ item: 'iron-plate', rate: 20 }] }, { id: 'b' }],
      [
        pull('self', 'a', 'a', 'iron-plate'),
        pull('ghost', 'a', 'zz', 'iron-plate'),
        pull('item', 'a', 'b', 'unobtainium'),
        fixed('tiny', 'a', 'b', 'iron-plate', 1e-9),
      ],
    );
    const r = await resolveWorld(world, model, solveFactory);
    expect(r.links).toEqual([]);
    expect(r.diagnostics.map((d) => [d.code, 'link' in d ? d.link : ''])).toEqual([
      ['invalid-link', 'ghost'],
      ['invalid-link', 'item'],
      ['invalid-link', 'self'],
      ['invalid-link', 'tiny'],
    ]);
  });

  test('a fixed link raises the producer’s demand and caps the consumer’s import', async () => {
    const world = buildWorld(
      [
        { id: 'a', targets: [{ item: 'iron-plate', rate: 15 }] },
        { id: 'b', targets: [{ item: 'reinforced-iron-plate', rate: 5 }] },
      ],
      [{ ...fixed('ab', 'a', 'b', 'iron-plate', 50), transport: { kind: 'belt', tier: 1 } }],
    );
    const r = await resolveWorld(world, model, solveFactory);
    // B draws 30 of the 50 it is sent; the other 20 is B's available supply.
    expect(link(r, 'ab')).toMatchObject({ requested: 50, delivered: 50, used: 30, carriers: 1 });
    expect(row(factory(r, 'a').ledger, 'iron-plate')).toMatchObject({ target: 15, exported: 50 });
    expect(row(factory(r, 'b').ledger, 'iron-plate')).toMatchObject({ imported: 50, surplus: 20 });
    expect(row(r.ledger, 'iron-plate')).toMatchObject({ target: 15, surplus: 20 });
  });

  test('a pull link carries only what its consumer needs; free imports upstream are not processed into junk (R7)', async () => {
    // B has 25 rods/min on hand (a capped unassigned import, or a fixed link
    // from A) and C pulls 40 screws/min from B: B makes 40 screws from 10 rods,
    // not 100 screws with 60 left over.
    for (const viaLink of [false, true]) {
      const world = buildWorld(
        [
          { id: 'a' },
          viaLink ? { id: 'b' } : { id: 'b', unassignedImports: [{ item: 'iron-rod', cap: 25 }] },
          { id: 'c', targets: [{ item: 'screw', rate: 40 }] },
        ],
        [
          pull('bc', 'b', 'c', 'screw'),
          ...(viaLink ? [fixed('ab', 'a', 'b', 'iron-rod', 25)] : []),
        ],
      );
      const r = await resolveWorld(world, model, solveFactory);
      expect(r.diagnostics).toEqual([]);
      expect(link(r, 'bc')).toMatchObject({ requested: 40, delivered: 40, used: 40 });
      const b = factory(r, 'b');
      expect(row(b.ledger, 'screw')).toMatchObject({ produced: 40, exported: 40, surplus: 0 });
      expect(b.result.imports).toEqual([{ item: 'iron-rod', rate: expect.closeTo(10, 9) }]);
      if (viaLink) {
        // A fixed link ships its rate: the 15 rods B leaves unused are B's supply (A21).
        expect(link(r, 'ab')).toMatchObject({ requested: 25, delivered: 25 });
        expect(link(r, 'ab').used).toBeCloseTo(10, 9);
        expect(row(b.ledger, 'iron-rod')!.surplus).toBeCloseTo(15, 9);
      } else expect(row(b.ledger, 'iron-rod')).toMatchObject({ consumed: 10, unmet: 10 });
      expect(row(r.ledger, 'screw')).toMatchObject({ produced: 40, target: 40, surplus: 0 });
    }
  });

  test('fixed links are drawn before pull links, pull links share the rest', async () => {
    const world = buildWorld(
      [
        { id: 'p1' },
        { id: 'p2' },
        { id: 'p3' },
        { id: 'c', targets: [{ item: 'iron-plate', rate: 100 }] },
      ],
      [
        fixed('f', 'p1', 'c', 'iron-plate', 20),
        pull('q2', 'p2', 'c', 'iron-plate'),
        pull('q3', 'p3', 'c', 'iron-plate'),
      ],
    );
    const r = await resolveWorld(world, model, solveFactory);
    expect(link(r, 'f').used).toBe(20);
    expect(link(r, 'q2').requested).toBeCloseTo(40, 9);
    expect(link(r, 'q3').requested).toBeCloseTo(40, 9);
  });
});

describe('linked-import costing (A18)', () => {
  test('a linked import costs the upstream plan’s marginal cost', async () => {
    const world = buildWorld(
      [
        { id: 'a' },
        {
          id: 'b',
          targets: [{ item: 'reinforced-iron-plate', rate: 5 }],
          request: { costImports: true },
        },
      ],
      [pull('ab', 'a', 'b', 'iron-plate')],
    );
    const r = await resolveWorld(world, model, solveFactory);
    expect(r.diagnostics).toEqual([]);
    const b = factory(r, 'b');
    expect(b.request.importCosts).toEqual([
      {
        item: 'iron-plate',
        rate: 30,
        cost: { resources: expect.closeTo(1.5 / 60, 9) },
        resourceTypes: ['iron-ore'],
      },
    ]);
    expect(factory(r, 'a').request.marginalCosts).toEqual({
      items: ['iron-plate'],
      objectives: ['resources'],
    });
    // B's O1 value charges the plates it imports: 30 × 1/40 node, plus its own screw chain.
    const own = b.result.nodes.reduce((s, n) => s + n.nne, 0);
    expect(b.result.objectiveValue).toBeCloseTo(own + 30 * (1.5 / 60), 9);
    expect(r.stats.passes).toBe(2);
  });

  test('without the toggle, linked imports are free and producers report no costs', async () => {
    const world = buildWorld(
      [{ id: 'a' }, { id: 'b', targets: [{ item: 'reinforced-iron-plate', rate: 5 }] }],
      [pull('ab', 'a', 'b', 'iron-plate')],
    );
    const r = await resolveWorld(world, model, solveFactory);
    expect(factory(r, 'a').request.marginalCosts).toBeUndefined();
    expect(factory(r, 'b').request.importCosts).toBeUndefined();
    expect(r.stats.passes).toBe(1);
  });
});

describe('factory controls (M6)', () => {
  test("a per-factory recipe override doesn't change other factories", async () => {
    // Two identical cable factories; only A turns on Iron Wire and solves under scarcity.
    const cable = [{ item: 'cable', rate: 30 }];
    const plain = buildWorld([
      { id: 'a', targets: cable, request: { objectives: ['scarcity'] } },
      { id: 'b', targets: cable, request: { objectives: ['scarcity'] } },
    ]);
    const edited = buildWorld([
      {
        id: 'a',
        targets: cable,
        request: { objectives: ['scarcity'], recipes: { 'iron-wire': true } },
      },
      { id: 'b', targets: cable, request: { objectives: ['scarcity'] } },
    ]);
    const cache = createSolveCache();
    const before = await resolveWorld(plain, model, solveFactory, cache);
    const calls = counting();
    const after = await resolveWorld(edited, model, calls, cache);
    const ids = (r: WorldResult, f: string) => factory(r, f).result.recipes.map((x) => x.id);
    expect(ids(before, 'a')).not.toContain('iron-wire');
    expect(ids(after, 'a')).toContain('iron-wire');
    // B is untouched: same request, same plan, and served from the cache.
    expect(factory(after, 'b').key).toBe(factory(before, 'b').key);
    expect(factory(after, 'b').result).toEqual(factory(before, 'b').result);
    expect(calls.calls).toHaveLength(1);
  });

  test('a world default applies to every factory unless one overrides it', async () => {
    const cable = [{ item: 'cable', rate: 30 }];
    const world = buildWorld([
      { id: 'a', targets: cable },
      { id: 'b', targets: cable, request: { recipes: { 'iron-wire': false } } },
    ]);
    world.defaults.objectives = ['scarcity'];
    world.defaults.recipes = { 'iron-wire': true };
    const r = await resolveWorld(world, model, solveFactory);
    const ids = (f: string) => factory(r, f).result.recipes.map((x) => x.id);
    expect(ids('a')).toContain('iron-wire');
    expect(ids('b')).not.toContain('iron-wire');
  });
});

describe('progress (M10)', () => {
  test('reports each factory as it starts, consumers first, without changing the result', async () => {
    const world = buildWorld(
      [{ id: 'a' }, { id: 'b' }, { id: 'c', targets: [{ item: 'modular-frame', rate: 2 }] }],
      [pull('ab', 'a', 'b', 'iron-plate'), pull('bc', 'b', 'c', 'reinforced-iron-plate')],
    );
    const seen: unknown[] = [];
    const cache = createSolveCache();
    const r = await resolveWorld(world, model, solveFactory, cache, {
      onProgress: (p) => seen.push(p),
    });
    expect(seen).toEqual([
      { factory: 'c', step: 1, factories: 3, pass: 1 },
      { factory: 'b', step: 2, factories: 3, pass: 1 },
      { factory: 'a', step: 3, factories: 3, pass: 1 },
    ]);
    expect(r).toEqual(await resolveWorld(world, model, solveFactory, createSolveCache()));
    // Memoized solves are reported too.
    seen.length = 0;
    await resolveWorld(world, model, solveFactory, cache, { onProgress: (p) => seen.push(p) });
    expect(seen).toHaveLength(3);
  });
});
