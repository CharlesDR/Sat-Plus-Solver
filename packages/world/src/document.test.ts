import { describe, expect, test } from 'vitest';
import {
  DEFAULT_FACTORY_ID,
  TOLERANCE_DEFAULT,
  TOLERANCE_MAX,
  TOLERANCE_MIN,
  WORLD_VERSION,
  clampTolerance,
  createWorld,
  factorySolveRequest,
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
      objectives: ['resources'],
      tolerance: TOLERANCE_DEFAULT,
      alternates: true,
      excludeRecipes: [],
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

describe('factorySolveRequest', () => {
  const world = (): World => {
    const w = createWorld();
    w.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    return w;
  };

  test('inherits the world defaults', () => {
    expect(factorySolveRequest(world(), model, DEFAULT_FACTORY_ID)).toEqual({
      targets: [{ item: 'iron-plate', rate: 60 }],
      objective: 'resources',
      recipes: { alternates: true, exclude: [] },
      nodeBudget: 'pool',
    });
  });

  test('factory overrides win; exclusions merge, deduplicated and sorted', () => {
    const w = world();
    w.defaults.excludeRecipes = ['b', 'a'];
    Object.assign(w.factories[0]!.request, {
      objectives: ['scarcity'],
      alternates: false,
      excludeRecipes: ['c', 'a'],
    });
    w.factories[0]!.unassignedImports.push({ item: 'iron-ingot' }, { item: 'screw', cap: 10 });
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID)).toEqual({
      targets: [{ item: 'iron-plate', rate: 60 }],
      objective: 'scarcity',
      recipes: { alternates: false, exclude: ['a', 'b', 'c'] },
      nodeBudget: 'pool',
      imports: [
        { item: 'iron-ingot', cap: Infinity },
        { item: 'screw', cap: 10 },
      ],
    });
  });

  test('pool edits and explicit budgets become node caps', () => {
    const w = world();
    w.nodePool = { 'node:iron-ore:pure': 1 };
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID).nodeBudget).toEqual({
      'node:iron-ore:normal': 4,
      'node:iron-ore:pure': 1,
    });
    w.factories[0]!.nodeBudget = { 'node:iron-ore:normal': 3 };
    expect(factorySolveRequest(w, model, DEFAULT_FACTORY_ID).nodeBudget).toEqual({
      'node:iron-ore:normal': 3,
    });
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
