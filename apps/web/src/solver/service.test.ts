import type { Model } from '@sps/data';
import { factoryGraph } from '@sps/graph';
import { compareTiers, createHighsBackend, seedCostCache, solve, summarizePlan } from '@sps/solver';
import { DEFAULT_FACTORY_ID, addFactory, addLink, createWorld, type World } from '@sps/world';
import { describe, expect, test } from 'vitest';
import miniJson from '../../../../fixtures/vanilla-mini/model.json';
import { createSolverService, modelCatalog, modelLabels, targetCatalog } from './service';
import { createFactoryPool, poolSize, type FromFactoryWorker, type ToFactoryWorker } from './pool';

const mini = miniJson as unknown as Model;
const backend = createHighsBackend();

describe('solver service', () => {
  test('the catalog lists producible items by name, without power', () => {
    const catalog = targetCatalog(mini);
    const names = catalog.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(catalog.map((c) => c.id)).toContain('iron-plate');
    expect(catalog.map((c) => c.id)).not.toContain('mw');
    // Every entry is some recipe's output.
    const produced = new Set(mini.recipes.flatMap((r) => r.outputs.map((o) => o.item)));
    expect(catalog.every((c) => produced.has(c.id))).toBe(true);
  });

  test('the catalog lists recipes, import items, nodes and tiers for the controls', () => {
    const tiered = {
      ...mini,
      recipes: mini.recipes.map((r, k) => ({ ...r, tier: ['0-0', '2-1', '10-0', '1-3'][k % 4]! })),
    };
    const c = modelCatalog(tiered);
    expect(c.targets).toEqual(targetCatalog(tiered));
    expect(c.items.map((i) => i.id)).toContain('iron-ore');
    expect(c.items.map((i) => i.id)).not.toContain('mw');
    expect(c.recipes).toHaveLength(mini.recipes.length);
    expect(c.recipes.find((r) => r.id === 'cast-screw')).toMatchObject({
      name: 'Alternate: Cast Screw',
      alternate: true,
      products: ['Screw'],
      outputs: ['screw'],
    });
    expect(c.nodes.map((n) => n.id).sort()).toEqual(mini.nodes.map((n) => n.id).sort());
    expect(c.nodes.find((n) => n.id === 'node:iron-ore:normal')?.label).toBe('Iron Ore (normal)');
    expect(c.tiers).toEqual(['1-3', '2-1', '10-0']);
    // Each target carries its lowest recipe tier (UX-17).
    const lowest = (item: string) =>
      tiered.recipes
        .filter((r) => r.outputs.some((o) => o.item === item))
        .map((r) => r.tier)
        .sort(compareTiers)[0];
    for (const t of c.targets) expect(t.tier).toBe(lowest(t.id));
    expect(structuredClone(c)).toEqual(c);
  });

  test("solves the world's factory and returns the same summary as the CLI path", async () => {
    const service = createSolverService(mini, backend);
    expect(service.dataHash).toBe('vanilla-mini');
    const world = createWorld('vanilla-mini');
    world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });

    const solved = await service.solve({ world, focus: DEFAULT_FACTORY_ID });
    const { plan, graph } = solved.focus!;
    const result = await solve(
      mini,
      {
        targets: [{ item: 'iron-plate', rate: 60 }],
        objective: 'scarcity',
        recipes: { alternates: false, exclude: [] },
      },
      backend,
    );
    expect(plan).toEqual(summarizePlan(mini, result));
    expect(plan.status).toBe('ok');
    expect(plan.targets).toEqual([{ item: 'iron-plate', name: 'Iron Plate', rate: 60 }]);
    // The flowchart comes from the same result, with display names.
    expect(graph).toEqual(factoryGraph(result, modelLabels(mini)));
    expect(graph.nodes.map((n) => n.label)).toContain('Iron Plate');
    expect(graph.nodes.find((n) => n.kind === 'target')?.label).toBe('Iron Plate');
    // Both cross the worker boundary, so they must survive structured cloning.
    expect(structuredClone(solved)).toEqual(solved);
  });

  test('its caches survive a reload: a seeded service answers from them (A90)', async () => {
    const world = createWorld('vanilla-mini');
    world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    const first = createSolverService(mini, backend);
    const solved = await first.solve({ world, focus: DEFAULT_FACTORY_ID });
    const saved = first.snapshot();
    expect(saved.dataHash).toBe('vanilla-mini');
    expect(saved.solves.length).toBe(1);
    // Saved through IndexedDB, so it must survive structured cloning.
    const reloaded = structuredClone(saved);
    // A solver that would fail shows the second service never solves.
    const broken = { ...backend, solve: () => Promise.reject(new Error('solved again')) };
    const second = createSolverService(mini, broken as typeof backend);
    second.seed(reloaded);
    const again = (await second.solve({ world, focus: DEFAULT_FACTORY_ID })).world;
    expect(again.stats).toMatchObject({ solves: 0, cacheHits: 1 });
    expect(again.factories).toEqual(solved.world.factories);
    // Caches of other data are ignored.
    const third = createSolverService(mini, backend);
    third.seed({ ...reloaded, dataHash: 'other' });
    expect(third.snapshot().solves).toEqual([]);
  });

  test('solver diagnostics come back in the summary', async () => {
    const service = createSolverService(mini, backend);
    const world = createWorld();
    world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    world.defaults.recipes = Object.fromEntries(
      mini.recipes
        .filter((r) => r.outputs.some((o) => o.item === 'iron-plate'))
        .map((r) => [r.id, false]),
    );
    const { plan, graph } = (await service.solve({ world, focus: DEFAULT_FACTORY_ID })).focus!;
    expect(plan.status).toBe('unreachable');
    expect(graph).toEqual({ nodes: [], edges: [] });
    expect(plan.diagnostics[0]?.severity).toBe('error');
    expect(plan.recipes).toEqual([]);
  });

  test('the catalog carries fluids and belt and pipe capacities for the link editor', () => {
    const c = modelCatalog(mini);
    expect(c.fluids).toContain('water');
    expect(c.fluids).not.toContain('iron-ore');
    expect(c.belts).toEqual(mini.beltCapacities);
    expect(c.pipes).toEqual([
      { tier: 1, perMin: 300 },
      { tier: 2, perMin: 600 },
    ]);
  });
});

/** A (no targets) pulls Iron Plate to B, which makes 3 Reinforced Iron Plate/min. */
function linked(): { world: World; a: string; b: string } {
  let w = createWorld('vanilla-mini');
  const a = addFactory(w, 'A');
  const b = addFactory(a.world, 'B');
  w = addLink(b.world, { from: a.id, to: b.id, item: 'iron-plate', mode: { kind: 'pull' } }).world;
  w = {
    ...w,
    factories: w.factories.map((f) =>
      f.id === b.id
        ? { ...f, request: { targets: [{ item: 'reinforced-iron-plate', rate: 3 }] } }
        : f,
    ),
  };
  return { world: w, a: a.id, b: b.id };
}

describe('world solves', () => {
  test("a focused factory's plan is solved in the world: link demand is part of it", async () => {
    const service = createSolverService(mini, backend);
    const { world, a } = linked();
    const solved = await service.solve({ world, focus: a });
    const f = solved.world.factories.find((x) => x.id === a)!;
    expect(f.request.demand).toEqual([{ item: 'iron-plate', rate: 18 }]);
    expect(f).not.toHaveProperty('result');
    expect(solved.focus!.factoryId).toBe(a);
    expect(solved.focus!.plan.targets).toEqual([
      { item: 'iron-plate', name: 'Iron Plate', rate: 18 },
    ]);
    expect(solved.world.links[0]).toMatchObject({ requested: 18, delivered: 18 });
    expect(structuredClone(solved)).toEqual(solved);
  });

  test('factory solves are memoized across world solves', async () => {
    const service = createSolverService(mini, backend);
    const { world } = linked();
    const first = await service.solve({ world });
    expect(first.world.stats.solves).toBeGreaterThan(0);
    const again = await service.solve({ world: { ...world, groups: [] } });
    expect(again.world.stats).toMatchObject({ solves: 0 });
  });

  test('"size power plant" returns the edited world, its MW target closing the deficit', async () => {
    const service = createSolverService(mini, backend);
    const { world } = linked();
    const plant = addFactory(world, 'Power');
    const solved = await service.solve({
      world: plant.world,
      action: { kind: 'size-power', factoryId: plant.id },
    });
    const target = solved.edited!.factories.find((f) => f.id === plant.id)!.request.targets;
    expect(target).toHaveLength(1);
    expect(target[0]!.item).toBe('mw');
    expect(Math.abs(solved.world.power.netMW)).toBeLessThan(1e-6);
  });

  test('swap previews solve the factory once per candidate, leaving the world as it is (A35)', async () => {
    const service = createSolverService(mini, backend);
    const world = createWorld('vanilla-mini');
    world.factories[0]!.request.targets.push({ item: 'screw', rate: 40 });
    const solved = await service.solve({
      world,
      focus: DEFAULT_FACTORY_ID,
      action: {
        kind: 'preview-swaps',
        factoryId: DEFAULT_FACTORY_ID,
        from: 'screw',
        candidates: ['cast-screw'],
      },
    });
    // The world itself is solved untweaked.
    expect(solved.focus!.plan.recipes.map((r) => r.id)).toContain('screw');
    expect(solved.previews).toHaveLength(1);
    const [p] = solved.previews!;
    expect(p).toMatchObject({ recipe: 'cast-screw', status: 'ok' });
    // Cast Screw skips the rod step: fewer machines than the current plan.
    const now = solved.world.factories[0]!;
    expect(p!.machines).toBeLessThan(now.machines);
    expect(p!.extraction.map((e) => e.item)).toEqual(['iron-ore']);
  });

  test('progress names each factory as it starts (M10)', async () => {
    const service = createSolverService(mini, backend);
    const world = createWorld('vanilla-mini');
    world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    const heard: unknown[] = [];
    await service.solve({ world }, (p) => heard.push(p));
    expect(heard).toEqual([
      { factory: 'Factory', step: 1, factories: 1, pass: 1, solving: 1, done: 0 },
    ]);
  });
});

describe('factory solve pool (S2)', () => {
  test('a pool gives the same world result and keeps the costs it learns', async () => {
    expect([poolSize(1), poolSize(2), poolSize(4), poolSize(16), poolSize(undefined)]).toEqual([
      1, 1, 3, 4, 1,
    ]);
    // Stand-in workers that solve in this thread.
    const workers = [0, 1, 2].map(() => {
      let listener: ((e: { data: FromFactoryWorker }) => void) | undefined;
      return {
        addEventListener: (_: 'message', l: typeof listener) => void (listener = l),
        postMessage: (msg: ToFactoryWorker) => {
          if (msg.type !== 'solve') return;
          void solve(mini, msg.request, backend).then((result) =>
            listener!({ data: { type: 'solved', id: msg.id, result, costs: [] } }),
          );
        },
      };
    });
    const pool = createFactoryPool(workers, (costs) => seedCostCache(mini, costs));
    const world = createWorld('vanilla-mini');
    world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    const pooled = await createSolverService(mini, backend, undefined, pool).solve({ world });
    const alone = await createSolverService(mini, backend).solve({ world });
    expect(pooled.world).toEqual(alone.world);
  });
});
