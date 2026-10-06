import type { Model } from '@sps/data';
import { createHighsBackend, OBJECTIVE_IDS, solve } from '@sps/solver';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import mini from '../../../fixtures/worlds/mini-world.json';
import v1 from '../../../fixtures/worlds/v1-world.json';
import v6 from '../../../fixtures/worlds/v6-world.json';
import { WORLD_VERSION, createWorld, type World } from './document';
import { migrateWorld } from './migrate';
import { WorldLoadError, extractFactory, loadWorld, parseWorld, serializeWorld } from './persist';
import { resolveWorld } from './resolve';
import { buildWorld, fixed, pull } from './testing';
import type { SolveFactory } from './types';

const SEED = 20261001;

/** A deep copy with ordinary prototypes (fast-check builds null-prototype objects). */
const plain = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(plain)
    : typeof v === 'object' && v !== null
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
      : v;

/** Random but valid current-version worlds, every optional field exercised. */
const worldArb: fc.Arbitrary<World> = (() => {
  const id = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
  const rate = fc.double({ min: 0, max: 1e5, noNaN: true, noDefaultInfinity: true });
  const text = fc.string({ maxLength: 12, unit: 'grapheme' });
  const stack = fc.uniqueArray(fc.constantFrom(...OBJECTIVE_IDS), { minLength: 1, maxLength: 3 });
  const toggles = fc.dictionary(id, fc.boolean(), { maxKeys: 4 });
  const tier = fc.option(fc.constantFrom('1-0', '2-3', '8-0'), { nil: null });
  const request = fc.record(
    {
      targets: fc.array(fc.record({ item: id, rate }), { maxLength: 3 }),
      objectives: stack,
      tolerance: fc.double({ min: 0.0001, max: 0.9, noNaN: true }),
      alternates: fc.boolean(),
      wholeMachines: fc.boolean(),
      costImports: fc.boolean(),
      recipes: toggles,
      maxTier: tier,
    },
    { requiredKeys: ['targets'] },
  );
  const factory = fc.record(
    {
      id,
      name: text,
      groupId: id,
      request,
      unassignedImports: fc.array(fc.record({ item: id, cap: rate }, { requiredKeys: ['item'] }), {
        maxLength: 2,
      }),
      resources: fc.dictionary(
        id,
        fc.record({ enabled: fc.boolean(), max: rate }, { requiredKeys: ['enabled'] }),
        { maxKeys: 3 },
      ),
      priority: fc.integer({ min: -5, max: 5 }),
      notes: text,
      tweaks: fc.array(
        fc.oneof(
          fc.record({ kind: fc.constant('ban' as const), recipe: id }),
          fc.record({ kind: fc.constant('swap' as const), from: id, to: id }),
          fc.record({ kind: fc.constant('import' as const), item: id }),
        ),
        { maxLength: 3 },
      ),
    },
    {
      requiredKeys: [
        'id',
        'name',
        'request',
        'unassignedImports',
        'resources',
        'priority',
        'notes',
        'tweaks',
      ],
    },
  );
  const group = fc.record(
    { id, name: text, parentId: id, collapsed: fc.boolean() },
    { requiredKeys: ['id', 'name', 'collapsed'] },
  );
  const link = fc.record(
    {
      id,
      from: id,
      to: id,
      item: id,
      mode: fc.oneof(
        fc.constant({ kind: 'pull' as const }),
        fc.record({ kind: fc.constant('fixed' as const), rate }),
      ),
      transport: fc.record(
        {
          kind: fc.constantFrom('belt', 'pipe', 'train', 'truck', 'drone', 'unspecified' as const),
          tier: fc.integer({ min: 1, max: 6 }),
        },
        { requiredKeys: ['kind'] },
      ),
    },
    { requiredKeys: ['id', 'from', 'to', 'item', 'mode'] },
  );
  const byId = { selector: (x: { id: string }) => x.id, maxLength: 5 };
  return (
    fc
      .record({
        meta: fc.record({
          v: fc.constant(WORLD_VERSION),
          dataHash: fc.stringMatching(/^[0-9a-f]{0,16}$/),
        }),
        factories: fc.uniqueArray(factory, byId),
        groups: fc.uniqueArray(group, byId),
        links: fc.uniqueArray(link, byId),
        defaults: fc.record({
          objectives: stack,
          tolerance: fc.double({ min: 0.0001, max: 0.9, noNaN: true }),
          alternates: fc.boolean(),
          wholeMachines: fc.boolean(),
          costImports: fc.boolean(),
          recipes: toggles,
          maxTier: tier,
        }),
        nodePool: fc.dictionary(id, fc.integer({ min: 0, max: 99 }), {
          maxKeys: 3,
          noNullPrototype: true,
        }),
      })
      // Plain prototypes, as a document read from JSON has.
      .map((w) => plain(w) as World)
  );
})();

describe('World → JSON → World', () => {
  test('is deep-equal for random worlds', () => {
    fc.assert(
      fc.property(worldArb, fc.boolean(), (w, pretty) => {
        expect(parseWorld(serializeWorld(w, pretty))).toStrictEqual(w);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  test('is deep-equal for the current-version fixture, and the fixture is current', () => {
    expect(v6.meta.v).toBe(WORLD_VERSION);
    const w = parseWorld(JSON.stringify(v6));
    expect(w).toStrictEqual(v6);
    expect(parseWorld(serializeWorld(w, true))).toStrictEqual(w);
  });

  test('migrates an old version on load', () => {
    expect(parseWorld(JSON.stringify(v1))).toStrictEqual(migrateWorld(v1));
    expect(loadWorld(mini).meta.v).toBe(WORLD_VERSION);
  });
});

describe('parseWorld rejects what it cannot read', () => {
  const bad = (doc: unknown) => () => loadWorld(doc);
  test('not JSON', () => {
    expect(() => parseWorld('{ nope')).toThrow(WorldLoadError);
    expect(() => parseWorld('{ nope')).toThrow(/Not valid JSON/);
  });
  test('not a world, or a newer version', () => {
    expect(bad(42)).toThrow(WorldLoadError);
    expect(bad({ meta: { v: WORLD_VERSION + 1, dataHash: '' } })).toThrow(/newer version/);
  });
  test('a malformed shape names what is wrong', () => {
    const w = createWorld();
    expect(bad({ ...w, factories: 'x' })).toThrow(/"factories" is not a list/);
    expect(bad({ ...w, links: [{ id: 'l', from: 'a', to: 'b', item: 'x', mode: {} }] })).toThrow(
      /links\[0\] is malformed/,
    );
    expect(bad({ ...w, defaults: { ...w.defaults, objectives: ['fastest'] } })).toThrow(
      /"defaults" is malformed/,
    );
    expect(bad({ ...w, factories: [...w.factories, ...w.factories] })).toThrow(
      /repeat the id "factory-main"/,
    );
    const f = w.factories[0]!;
    expect(
      bad({ ...w, factories: [{ ...f, request: { targets: [{ item: 'x', rate: '5' }] } }] }),
    ).toThrow(/factories\[0\] is malformed/);
  });
  test('dangling references still load (resolution reports them)', () => {
    const w = buildWorld([{ id: 'a', group: 'nowhere' }], [pull('l', 'a', 'ghost', 'iron-plate')]);
    expect(loadWorld(w)).toStrictEqual(w);
  });
});

describe('extractFactory (share this factory only)', () => {
  const world = () => {
    const w = buildWorld(
      [
        { id: 'a', group: 'g', unassignedImports: [{ item: 'iron-ore', cap: 10 }] },
        { id: 'b', targets: [{ item: 'iron-plate', rate: 5 }] },
        { id: 'c', targets: [{ item: 'reinforced-iron-plate', rate: 2 }] },
      ],
      [
        pull('ab', 'a', 'b', 'iron-plate'),
        fixed('ac', 'a', 'c', 'screw', 24),
        fixed('ba', 'b', 'a', 'iron-ore', 20),
        pull('ca', 'c', 'a', 'iron-ore'),
      ],
      [{ id: 'g', name: 'G', collapsed: false }],
    );
    w.defaults.alternates = true;
    w.nodePool = { 'node:iron-ore:pure': 1 };
    return w;
  };

  test('turns links into targets and imports, and keeps defaults and data hash', () => {
    const w = world();
    const before = JSON.stringify(w);
    const one = extractFactory(w, 'a', { ab: 18 });
    expect(one.meta).toEqual({ v: WORLD_VERSION, dataHash: 'test' });
    expect(one.groups).toEqual([]);
    expect(one.links).toEqual([]);
    expect(one.defaults).toEqual(w.defaults);
    expect(one.nodePool).toEqual(w.nodePool);
    expect(one.factories).toHaveLength(1);
    const f = one.factories[0]!;
    expect(f.id).toBe('a');
    expect(f.groupId).toBeUndefined();
    // Outgoing: the pull link at its resolved rate, the fixed link at its rate.
    expect(f.request.targets).toEqual([
      { item: 'iron-plate', rate: 18 },
      { item: 'screw', rate: 24 },
    ]);
    // Incoming: a fixed link adds its rate to the cap; a pull link lifts it.
    expect(f.unassignedImports).toEqual([{ item: 'iron-ore' }]);
    expect(JSON.stringify(w)).toBe(before);
    expect(loadWorld(one)).toStrictEqual(one);
  });

  test('merges with existing targets and capped imports; drops unresolved pull links', () => {
    const w = world();
    w.links = w.links.filter((l) => l.id !== 'ca');
    const f = extractFactory(w, 'a').factories[0]!;
    expect(f.request.targets).toEqual([{ item: 'screw', rate: 24 }]);
    expect(f.unassignedImports).toEqual([{ item: 'iron-ore', cap: 30 }]);
    const b = extractFactory(w, 'b').factories[0]!;
    expect(b.request.targets).toEqual([
      { item: 'iron-plate', rate: 5 },
      { item: 'iron-ore', rate: 20 },
    ]);
    expect(b.unassignedImports).toEqual([{ item: 'iron-plate' }]);
    expect(() => extractFactory(w, 'zz')).toThrow(/Unknown factory/);
  });

  test('the shared factory plans what it planned in the world', async () => {
    const model = vanillaMini as Model;
    const backend = createHighsBackend();
    const solveFactory: SolveFactory = (r) => solve(model, r, backend);
    const w = buildWorld(
      [{ id: 'a' }, { id: 'b' }, { id: 'c', targets: [{ item: 'modular-frame', rate: 2 }] }],
      [pull('ab', 'a', 'b', 'iron-plate'), pull('bc', 'b', 'c', 'reinforced-iron-plate')],
    );
    const r = await resolveWorld(w, model, solveFactory);
    const rates = Object.fromEntries(r.links.map((l) => [l.id, l.requested]));
    const inWorld = r.factories.find((f) => f.id === 'b')!;
    const alone = await resolveWorld(extractFactory(w, 'b', rates), model, solveFactory);
    expect(alone.diagnostics).toEqual([]);
    const shared = alone.factories[0]!;
    expect(shared.result.status).toBe('ok');
    const usage = (x: typeof shared) =>
      x.result.recipes.map((u) => ({ recipe: u.id, machines: u.machines }));
    expect(usage(shared)).toEqual(usage(inWorld));
    expect(shared.nodes).toEqual(inWorld.nodes);
    expect(shared.power.consumptionMW).toBeCloseTo(inWorld.power.consumptionMW, 9);
  });
});
