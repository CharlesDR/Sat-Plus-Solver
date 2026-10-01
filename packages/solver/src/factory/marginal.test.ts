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
