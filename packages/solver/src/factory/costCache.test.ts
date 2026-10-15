import type { Model } from '@sps/data';
import { expect, test } from 'vitest';
import vanillaMini from '../../../../fixtures/vanilla-mini/model.json';
import { createHighsBackend } from '../lp/highs';
import { costCacheEntries, seedCostCache, solve } from './solve';

const backend = createHighsBackend();
/** A deep copy, as a save and a reload make. */
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const request = {
  targets: [{ item: 'reinforced-iron-plate', rate: 5 }],
  imports: [{ item: 'iron-plate', cap: Infinity }],
  costImports: true,
};

test('the embodied-cost cache can be saved and seeded into fresh model data (A90)', async () => {
  // Each copy of the model data has its own cache, as after a reload.
  const first = copy(vanillaMini as Model);
  const plan = await solve(first, request, backend);
  const saved = copy(costCacheEntries(first));
  expect(saved.length).toBeGreaterThan(0);
  const second = copy(vanillaMini as Model);
  expect(costCacheEntries(second)).toEqual([]);
  seedCostCache(second, saved);
  expect(costCacheEntries(second)).toEqual(saved);
  // Costed from the seeded cache, the plan is the same.
  expect(await solve(second, request, backend)).toEqual(plan);
});
