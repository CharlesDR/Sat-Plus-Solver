import type { Model } from '@sps/data';
import { createHighsBackend, solve, summarizePlan } from '@sps/solver';
import { DEFAULT_FACTORY_ID, createWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import miniJson from '../../../../fixtures/vanilla-mini/model.json';
import { createSolverService, targetCatalog } from './service';

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

  test("solves the world's factory and returns the same summary as the CLI path", async () => {
    const service = createSolverService(mini, backend);
    expect(service.dataHash).toBe('vanilla-mini');
    const world = createWorld('vanilla-mini');
    world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });

    const plan = await service.solve(world, DEFAULT_FACTORY_ID);
    const direct = summarizePlan(
      mini,
      await solve(
        mini,
        { targets: [{ item: 'iron-plate', rate: 60 }], objective: 'resources' },
        backend,
      ),
    );
    expect(plan).toEqual(direct);
    expect(plan.status).toBe('ok');
    expect(plan.targets).toEqual([{ item: 'iron-plate', name: 'Iron Plate', rate: 60 }]);
    // The summary crosses the worker boundary, so it must survive structured cloning.
    expect(structuredClone(plan)).toEqual(plan);
  });

  test('solver diagnostics come back in the summary', async () => {
    const service = createSolverService(mini, backend);
    const world = createWorld();
    world.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 60 });
    world.defaults.excludeRecipes = mini.recipes
      .filter((r) => r.outputs.some((o) => o.item === 'iron-plate'))
      .map((r) => r.id);
    const plan = await service.solve(world, DEFAULT_FACTORY_ID);
    expect(plan.status).toBe('unreachable');
    expect(plan.diagnostics[0]?.severity).toBe('error');
    expect(plan.recipes).toEqual([]);
  });
});
