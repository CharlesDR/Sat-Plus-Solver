import { filterMinerRoutes, minerFluidOptions } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import { loadModel } from './solve';

/** Miner fluids (A69) on the SF+ data: the ores with no plain route, derived, not hard-coded. */
describe('miner fluids on the SF+ data', async () => {
  const model = await loadModel();
  const options = minerFluidOptions(model.recipes);
  const needy = [...options].filter(([, o]) => !o.plain);

  test('Kerr Crystal, Sulfur and Uranium have no plain route', () => {
    expect(needy.map(([ore]) => ore).sort()).toEqual(['kerr-crystal', 'sulfur', 'uranium']);
  });

  test('Kerr Crystal and Uranium may not use Water; Sulfur may', () => {
    const water = (ore: string) => options.get(ore)!.fluids.includes('water');
    expect(water('kerr-crystal')).toBe(false);
    expect(water('uranium')).toBe(false);
    expect(water('sulfur')).toBe(true);
  });

  test('without fluid modules, every ore keeps a route: plain, else Water, else its own fluids', () => {
    const kept = filterMinerRoutes(model.recipes, 'none').filter((r) => r.route);
    const fluids = (ore: string) =>
      [...new Set(kept.filter((r) => r.route!.resource === ore).map((r) => r.route!.fluid))].sort();
    for (const [ore, o] of options)
      expect(fluids(ore)).toEqual(
        o.plain ? [null] : o.fluids.includes('water') ? ['water'] : o.fluids,
      );
  });
});
