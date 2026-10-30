import type { Model } from '@sps/data';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../../fixtures/vanilla-mini/model.json';
import { createHighsBackend } from '../lp/highs';
import { solve } from './solve';

const mini = vanillaMini as Model;
const backend = createHighsBackend();

describe('marginal costs (A18, linked-import costing)', () => {
  test('an LP plan’s marginal cost equals its standalone embodied cost', async () => {
    const plan = await solve(
      mini,
      {
        targets: [{ item: 'iron-plate', rate: 60 }],
        marginalCosts: { items: ['iron-plate', 'unused-item'], objectives: ['resources', 'power'] },
      },
      backend,
    );
    expect(plan.status).toBe('ok');
    // 1 plate = 1.5 ore = 1/40 normal node; power: (5 + 4 + 4·1.5) MW over 60 ore … per plate.
    expect(plan.marginalCosts).toEqual([
      {
        item: 'iron-plate',
        rate: 60,
        cost: {
          resources: expect.closeTo(1.5 / 60, 9),
          power: expect.closeTo((1.5 * 5) / 60 + (1.5 * 4) / 30 + 4 / 20, 9),
        },
        resourceTypes: ['iron-ore'],
      },
    ]);
    // A consumer charged this cost pays what a standalone plan would.
    const consumer = await solve(
      mini,
      {
        targets: [{ item: 'reinforced-iron-plate', rate: 5 }],
        imports: [{ item: 'iron-plate', cap: Infinity }],
        costImports: true,
        importCosts: plan.marginalCosts!,
      },
      backend,
    );
    const standalone = await solve(
      mini,
      {
        targets: [{ item: 'reinforced-iron-plate', rate: 5 }],
        imports: [{ item: 'iron-plate', cap: Infinity }],
        costImports: true,
      },
      backend,
    );
    expect(consumer.status).toBe('ok');
    expect(consumer.objectiveValue).toBeCloseTo(standalone.objectiveValue!, 9);
    expect(consumer.importCosts?.map((c) => c.item)).toEqual(['iron-plate']);
  });

  test('a byproduct in surplus is free at the margin', async () => {
    const plan = await solve(
      mini,
      {
        targets: [{ item: 'plastic', rate: 20 }],
        marginalCosts: { items: ['heavy-oil-residue'], objectives: ['resources'] },
      },
      backend,
    );
    expect(plan.marginalCosts?.[0]?.cost.resources).toBe(0);
  });

  test('the free part of an import costs nothing (DF-5, A99)', async () => {
    // Solid Steel Ingot makes B's own steel cheaper than the given cost of
    // importing it, so only the free part is imported.
    const plan = (free?: number) =>
      solve(
        mini,
        {
          targets: [{ item: 'steel-beam', rate: 15 }],
          objectives: ['resources'],
          recipes: { include: ['solid-steel-ingot'] },
          costImports: true,
          imports: [{ item: 'steel-ingot', cap: 30, ...(free ? { free } : {}) }],
          importCosts: [
            { item: 'steel-ingot', rate: 30, cost: { resources: 1 }, resourceTypes: ['coal'] },
          ],
        },
        backend,
      );
    const imported = (r: Awaited<ReturnType<typeof plan>>) =>
      r.imports.find((i) => i.item === 'steel-ingot')?.rate ?? 0;
    const paid = await plan();
    expect(paid.status).toBe('ok');
    expect(imported(paid)).toBeCloseTo(0, 9);
    const part = await plan(20);
    expect(imported(part)).toBeCloseTo(20, 9);
    // Charged nothing for the 20: the value is its own 40 ingots' ore and coal.
    const own = part.nodes.reduce((s, n) => s + n.nne, 0);
    expect(part.objectiveValue).toBeCloseTo(own, 9);
    // A free part above the cap is clamped to it.
    expect(imported(await plan(50))).toBeCloseTo(30, 9);
  });

  test('rejects a negative free import', async () => {
    const r = await solve(
      mini,
      {
        targets: [{ item: 'iron-plate', rate: 60 }],
        imports: [{ item: 'iron-ingot', cap: 10, free: -1 }],
      },
      backend,
    );
    expect(r.diagnostics[0]?.code).toBe('invalid-request');
  });

  test('rejects a negative given cost', async () => {
    const r = await solve(
      mini,
      {
        targets: [{ item: 'iron-plate', rate: 60 }],
        importCosts: [{ item: 'iron-ingot', rate: 1, cost: { resources: -1 }, resourceTypes: [] }],
      },
      backend,
    );
    expect(r.diagnostics[0]?.code).toBe('invalid-request');
  });
});
