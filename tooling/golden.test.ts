import type { Model } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { beforeAll, describe, expect, test } from 'vitest';
import { runPipeline } from './build-data';
import { compareGolden, loadGoldenCases, loadVanillaMini } from './golden';

const backend = createHighsBackend();
const model = loadVanillaMini();
const cases = loadGoldenCases();
let sfplus: Model;

beforeAll(async () => {
  if (cases.some((c) => c.model === 'sfplus')) sfplus = (await runPipeline()).result.model!;
}, 120_000);

describe('golden cases', () => {
  test('there are at least 5 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
  });

  test.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const result = await solve(c.model === 'sfplus' ? sfplus : model, c.request, backend);
    expect(compareGolden(c, result)).toEqual([]);
  });

  test('the harness reports a mismatch', async () => {
    const c = cases.find((x) => x.name === 'iron-plate-60')!;
    const result = await solve(model, c.request, backend);
    const wrong = {
      ...c,
      expected: { ...c.expected, recipes: { ...c.expected.recipes, 'iron-plate': 3.0001 } },
    };
    expect(compareGolden(wrong, result)).toEqual(['recipe iron-plate: got 3, expected 3.0001']);
  });
});
