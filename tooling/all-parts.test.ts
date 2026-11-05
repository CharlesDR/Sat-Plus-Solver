import type { Model } from '@sps/data';
import { createHighsBackend, createSolver, solve, type Solver } from '@sps/solver';
import { beforeAll, describe, expect, test } from 'vitest';
import { KNOWN_GAPS, partSeed, partTargets, seededSample, solvePart } from './all-parts';
import { modVersions, PINNED_VERSION, readInputs, runPipeline } from './build-data';

const backend = createHighsBackend();
const seed = partSeed();
const models = new Map<string, Promise<Model>>();
/** Each version's model, built once for the whole file. */
const modelOf = (version: string): Promise<Model> => {
  if (!models.has(version))
    models.set(
      version,
      runPipeline(readInputs(version)).then(({ result }) => result.model!),
    );
  return models.get(version)!;
};

// Every mod version (A111) solves its own sample.
describe.each(modVersions())(
  `%s: every part solves: a sample of 10 (SPS_PART_SEED=${seed}; pnpm test:all-parts runs all)`,
  (version) => {
    let model: Model;
    let solver: Solver;
    let sample: string[] = [];

    beforeAll(async () => {
      model = await modelOf(version);
      solver = createSolver(model, backend);
      sample = seededSample(partTargets(model), 10, seed);
    }, 120_000);

    test('the sample is reproducible from its seed', () => {
      expect(seededSample(partTargets(model), 10, seed)).toEqual(sample);
      expect(sample).toHaveLength(10);
    });

    test('known gaps are only the two sludge items', () => {
      expect(Object.keys(KNOWN_GAPS).sort()).toEqual(['packaged-raw-sludge', 'raw-sludge']);
      const made = new Set(model.recipes.flatMap((r) => r.outputs.map((o) => o.item)));
      for (const g of Object.keys(KNOWN_GAPS)) expect(made.has(g)).toBe(true);
    });

    test('each sampled part solves at 1/min with no error', async () => {
      for (const item of sample) {
        const r = await solvePart(solver, item);
        expect({ item, status: r.status, errors: r.errors }, `seed ${seed}`).toEqual({
          item,
          status: 'ok',
          errors: [],
        });
      }
    }, 180_000);
  },
);

describe('Space Elevator phases in top-part rate (A84)', () => {
  test('Phase 2 at 10/min takes 10 Smart Plating, 10 Versatile Framework and 5 Automated Wiring', async () => {
    const r = await solve(
      await modelOf(PINNED_VERSION),
      {
        targets: [{ item: 'virtual:space-elevator-phase-2', rate: 10 }],
        recipes: { alternates: true },
      },
      backend,
    );
    expect(r.status).toBe('ok');
    const phase = r.recipes.find((u) => u.id === 'space-elevator-phase-2')!;
    const take = Object.fromEntries(phase.inputs.map((f) => [f.item, f.rate]));
    expect(take['smart-plating']).toBeCloseTo(10, 9);
    expect(take['versatile-framework']).toBeCloseTo(10, 9);
    expect(take['automated-wiring']).toBeCloseTo(5, 9);
  });
});
