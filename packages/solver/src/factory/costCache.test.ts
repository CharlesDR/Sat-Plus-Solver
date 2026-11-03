import type { Model } from '@sps/data';
import { expect, test } from 'vitest';
import vanillaMini from '../../../../fixtures/vanilla-mini/model.json';
import { createHighsBackend } from '../lp/highs';
import { createSolver } from './solve';

const backend = createHighsBackend();
/** A deep copy, as a save and a reload make. */
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const request = {
  targets: [{ item: 'reinforced-iron-plate', rate: 5 }],
  imports: [{ item: 'iron-plate', cap: Infinity }],
  costImports: true,
};

test('the embodied-cost cache can be saved and seeded into a fresh solver (A90)', async () => {
  // Each solver has its own cache; a new one on a copy of the data is a reload.
  const first = createSolver(copy(vanillaMini as Model), backend);
  const plan = await first.solve(request);
  const saved = copy(first.costEntries());
  expect(saved.length).toBeGreaterThan(0);
  const second = createSolver(copy(vanillaMini as Model), backend);
  expect(second.costEntries()).toEqual([]);
  second.seedCosts(saved);
  expect(second.costEntries()).toEqual(saved);
  // Costed from the seeded cache, the plan is the same.
  expect(await second.solve(request)).toEqual(plan);
});

test('seeding keeps the entries a solver already has (A90)', async () => {
  const solver = createSolver(vanillaMini as Model, backend);
  await solver.solve(request);
  const own = copy(solver.costEntries());
  solver.seedCosts(own.map(([key]) => [key, { item: 'x', rate: 1, cost: {}, resourceTypes: [] }]));
  expect(solver.costEntries()).toEqual(own);
});
