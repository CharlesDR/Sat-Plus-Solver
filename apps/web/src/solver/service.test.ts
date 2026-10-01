import type { Model } from '@sps/data';
import { factoryGraph } from '@sps/graph';
import { createHighsBackend, solve, summarizePlan } from '@sps/solver';
import { DEFAULT_FACTORY_ID, createWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import miniJson from '../../../../fixtures/vanilla-mini/model.json';
import { createSolverService, modelCatalog, modelLabels, targetCatalog } from './service';

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
    });
    expect(c.nodes.map((n) => n.id).sort()).toEqual(mini.nodes.map((n) => n.id).sort());
    expect(c.nodes.find((n) => n.id === 'node:iron-ore:normal')?.label).toBe('Iron Ore (normal)');
    expect(c.tiers).toEqual(['1-3', '2-1', '10-0']);
    expect(structuredClone(c)).toEqual(c);
  });

  test("solves the world's factory and returns the same summary as the CLI path", async () => {
    const service = createSolverService(mini, backend);
    expect(service.dataHash).toBe('vanilla-mini');
    const world = createWorld('vanilla-mini');
    world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });

    const solved = await service.solve(world, DEFAULT_FACTORY_ID);
    const { plan, graph } = solved;
    const result = await solve(
      mini,
      {
        targets: [{ item: 'iron-plate', rate: 60 }],
        objective: 'resources',
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

  test('solver diagnostics come back in the summary', async () => {
    const service = createSolverService(mini, backend);
    const world = createWorld();
    world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    world.defaults.recipes = Object.fromEntries(
      mini.recipes
        .filter((r) => r.outputs.some((o) => o.item === 'iron-plate'))
        .map((r) => [r.id, false]),
    );
    const { plan, graph } = await service.solve(world, DEFAULT_FACTORY_ID);
    expect(plan.status).toBe('unreachable');
    expect(graph).toEqual({ nodes: [], edges: [] });
    expect(plan.diagnostics[0]?.severity).toBe('error');
    expect(plan.recipes).toEqual([]);
  });
});
