import { describe, expect, test } from 'vitest';
import {
  DEFAULT_FACTORY_ID,
  TOLERANCE_DEFAULT,
  TOLERANCE_MAX,
  TOLERANCE_MIN,
  WORLD_VERSION,
  clampTolerance,
  createFactory,
  createWorld,
  factorySolveRequest,
  freshWorld,
  renameWorld,
  type World,
} from './document';

const model = {
  nodes: [
    {
      id: 'node:iron-ore:normal',
      resource: 'iron-ore',
      purity: 'normal' as const,
      count: 4,
      nne: 1,
    },
    { id: 'node:iron-ore:pure', resource: 'iron-ore', purity: 'pure' as const, count: 2, nne: 2 },
  ],
};

describe('World document', () => {
  test('a fresh world has one implicit factory and the defaults', () => {
    const w = createWorld('abc');
    expect(w.meta).toEqual({ v: WORLD_VERSION, dataHash: 'abc' });
    expect(w.factories.map((f) => f.id)).toEqual([DEFAULT_FACTORY_ID]);
    expect(w.groups).toEqual([]);
    expect(w.links).toEqual([]);
    expect(w.defaults).toEqual({
      objectives: ['scarcity'],
      tolerance: TOLERANCE_DEFAULT,
      alternates: false,
      wholeMachines: false,
      costImports: false,
      avoidFluidByproducts: true,
      minerFluids: 'any',
      minerFluidSupply: 'outside',
      recipes: {},
      maxTier: null,
    });
  });

  test('round-trips through JSON unchanged', () => {
    const w = createWorld('abc');
    w.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    w.factories[0]!.unassignedImports.push({ item: 'iron-ingot' }, { item: 'screw', cap: 10 });
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  test('tolerance clamps to 0.01%–90%', () => {
    expect(TOLERANCE_DEFAULT).toBe(0.0001);
    expect(clampTolerance(0)).toBe(TOLERANCE_MIN);
    expect(clampTolerance(5)).toBe(TOLERANCE_MAX);
    expect(clampTolerance(0.05)).toBe(0.05);
    expect(clampTolerance(Number.NaN)).toBe(TOLERANCE_DEFAULT);
  });
});

describe('fresh worlds and names (N1, N2, N8)', () => {
  const busy = (): World => {
    const w = createWorld('h');
    w.defaults.alternates = true;
    w.defaults.recipes = { a: false };
    w.nodePool = { 'node:iron-ore:pure': 1 };
    w.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    w.factories.push(createFactory('f2', 'Second'));
    w.meta.name = 'Old';
    return w;
  };

  test('keeping settings keeps defaults and the node pool, and nothing else', () => {
    const old = busy();
    const w = freshWorld(old, true, ' Phase 2 ');
    expect(w).toEqual({
      ...createWorld('h'),
      meta: { ...createWorld('h').meta, name: 'Phase 2' },
      defaults: old.defaults,
      nodePool: old.nodePool,
    });
    // A copy: editing the new world leaves the old one alone.
    w.defaults.recipes.b = true;
    expect(old.defaults.recipes).toEqual({ a: false });
  });

  test('an empty start is a new world on the same data, unnamed when blank', () => {
    expect(freshWorld(busy(), false, '  ')).toEqual(createWorld('h'));
  });

  test('renaming sets or clears the name', () => {
    const w = renameWorld(createWorld('h'), ' Base ');
    expect(w.meta).toEqual({ v: WORLD_VERSION, dataHash: 'h', name: 'Base' });
    expect(renameWorld(w, '').meta).toEqual({ v: WORLD_VERSION, dataHash: 'h' });
  });
});

describe('factorySolveRequest', () => {
  const world = (): World => {
    const w = createWorld();
    w.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    return w;
  };

  test('inherits the world defaults', () => {
    expect(factorySolveRequest(world(), model, DEFAULT_FACTORY_ID)).toEqual({
      targets: [{ item: 'iron-plate', rate: 60 }],
      objectives: ['scarcity'],
      tolerance: TOLERANCE_DEFAULT,
      recipes: { alternates: false, exclude: [] },
      nodeBudget: 'pool',
      avoidFluidByproducts: true,
      minerFluidSupply: 'outside',
    });
  });

  test('factory overrides win; recipe toggles merge over the world, sorted', () => {
    const w = world();
    w.defaults.recipes = { b: false, a: false, alt: true };
    Object.assign(w.factories[0]!.request, {
      objectives: ['scarcity', 'machines'],
      tolerance: 0.05,
      alternates: false,
      recipes: { c: false, b: true, alt: false, alt2: true },
      minerFluids: 'none',
      minerFluidSupply: 'local',
    });
    w.factories[0]!.unassignedImports.push({ item: 'iron-ingot' }, { item: 'screw', cap: 10 });
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID)).toEqual({
      targets: [{ item: 'iron-plate', rate: 60 }],
      objectives: ['scarcity', 'machines'],
      tolerance: 0.05,
      recipes: { alternates: false, exclude: ['a', 'alt', 'c'], include: ['alt2', 'b'] },
      nodeBudget: 'pool',
      imports: [
        { item: 'iron-ingot', cap: Infinity },
        { item: 'screw', cap: 10 },
      ],
      avoidFluidByproducts: true,
      minerFluids: 'none',
    });
  });

  test('max tier inherits, and a factory can set its own or lift it with null', () => {
    const w = world();
    const tier = () => factorySolveRequest(w, model, DEFAULT_FACTORY_ID).recipes?.maxTier;
    expect(tier()).toBeUndefined();
    w.defaults.maxTier = '3-2';
    expect(tier()).toBe('3-2');
    w.factories[0]!.request.maxTier = '5-0';
    expect(tier()).toBe('5-0');
    w.factories[0]!.request.maxTier = null;
    expect(tier()).toBeUndefined();
  });

  test("a per-factory override doesn't change other factories", () => {
    const w = world();
    w.factories.push(createFactory('b', 'B'));
    w.factories[1]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    const before = factorySolveRequest(w, model, 'b');
    Object.assign(w.factories[0]!.request, {
      alternates: true,
      recipes: { 'cast-screw': true, 'iron-plate': false },
      maxTier: '2-0',
      objectives: ['machines'],
      tolerance: 0.1,
      wholeMachines: true,
    });
    w.factories[0]!.resources = { 'iron-ore': { enabled: false } };
    w.factories[0]!.unassignedImports.push({ item: 'iron-ingot', cap: 5 });
    expect(factorySolveRequest(w, model, 'b')).toEqual(before);
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID)).not.toEqual(before);
  });

  test('whole machines and import costing inherit, and a factory can override them', () => {
    const w = world();
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID)).not.toHaveProperty('costImports');
    w.defaults.costImports = true;
    w.factories[0]!.request.wholeMachines = true;
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID)).toMatchObject({
      costImports: true,
      wholeMachines: true,
    });
    w.factories[0]!.request.costImports = false;
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID)).not.toHaveProperty('costImports');
  });

  test('avoid fluid byproducts is on by default, and a factory can turn it off (A39)', () => {
    const w = world();
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID).avoidFluidByproducts).toBe(true);
    w.factories[0]!.request.avoidFluidByproducts = false;
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID)).not.toHaveProperty(
      'avoidFluidByproducts',
    );
    w.defaults.avoidFluidByproducts = false;
    w.factories[0]!.request.avoidFluidByproducts = true;
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID).avoidFluidByproducts).toBe(true);
  });

  test('pool edits become node caps', () => {
    const w = world();
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID).nodeBudget).toBe('pool');
    w.nodePool = { 'node:iron-ore:pure': 1 };
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID).nodeBudget).toEqual({
      'node:iron-ore:normal': 4,
      'node:iron-ore:pure': 1,
    });
  });

  test('resource limits (A33): off is 0, a max is its rate, on without a max is no limit', () => {
    const w = world();
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID)).not.toHaveProperty('resourceLimits');
    w.factories[0]!.resources = {
      water: { enabled: false },
      'iron-ore': { enabled: true, max: 120 },
      coal: { enabled: true },
      limestone: { enabled: false, max: 30 },
    };
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID).resourceLimits).toEqual({
      'iron-ore': 120,
      limestone: 0,
      water: 0,
    });
    expect(Object.keys(factorySolveRequest(w, model, DEFAULT_FACTORY_ID).resourceLimits!)).toEqual([
      'iron-ore',
      'limestone',
      'water',
    ]);
  });

  test('does not alias the document', () => {
    const w = world();
    const req = factorySolveRequest(w, model, DEFAULT_FACTORY_ID);
    (req.targets as unknown as { rate: number }[])[0]!.rate = 1;
    expect(w.factories[0]!.request.targets[0]!.rate).toBe(60);
  });

  test('unknown factory throws', () => {
    expect(() => factorySolveRequest(world(), model, 'nope')).toThrow(/Unknown factory/);
  });
});
