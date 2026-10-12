import type { Model } from '@sps/data';
import { createHighsBackend, solve, starterNote, summarizePlan } from '@sps/solver';
import { beforeAll, describe, expect, test } from 'vitest';
import { runPipeline } from './build-data';

const backend = createHighsBackend();
let model: Model;

beforeAll(async () => {
  model = (await runPipeline()).result.model!;
}, 120_000);

describe('slug production on the SF+ model (S2, A74)', () => {
  const slugs = ['blue', 'copper', 'iron', 'lime', 'orange', 'pink', 'purple', 'red'].concat([
    'turquise',
    'white',
    'yellow',
  ]);

  test.each(slugs)('%s slug breeds from map resources and a starter', async (s) => {
    const r = await solve(model, { targets: [{ item: `${s}-slug`, rate: 1 }] }, backend);
    expect(r.status).toBe('ok');
    expect(r.starters?.length).toBeGreaterThan(0);
  });

  test('Golden Slug stays unreachable: its Gourmet Meal loop is excluded', async () => {
    const r = await solve(model, { targets: [{ item: 'golden-slug', rate: 1 }] }, backend);
    expect(r.status).toBe('unreachable');
    expect(
      model.recipes.some((x) => /^(copper|iron|golden)-(egg-terrarium|slug-breeding)$/.test(x.id)),
    ).toBe(false);
  });

  test('a plan that needs no loop uses none', async () => {
    const r = await solve(model, { targets: [{ item: 'iron-plate', rate: 30 }] }, backend);
    expect(r.status).toBe('ok');
    expect(r.recipes.filter((x) => /slug|egg/.test(x.id))).toEqual([]);
    expect(r.starters).toBeUndefined();
  });

  test('the plan notes its starter, with no count', async () => {
    const r = await solve(
      model,
      {
        targets: [{ item: 'lime-slug', rate: 9.6 }],
        imports: [
          { item: 'sweet-meal', cap: Infinity },
          { item: 'water', cap: Infinity },
        ],
      },
      backend,
    );
    expect(r.starters).toEqual(['lime-slug']);
    expect(starterNote(summarizePlan(model, r))).toBe('Needs starter Lime Slugs.');
  });

  test('an imported slug needs no starter, and an import capped at 0 is no source', async () => {
    const base = {
      targets: [{ item: 'lime-egg', rate: 6 }],
      imports: [{ item: 'sweet-meal', cap: Infinity }],
      recipes: { exclude: ['lime-slug-breeding', 'purple-slug-breeding', 'white-slug-breeding'] },
    };
    const imported = await solve(
      model,
      { ...base, imports: [...base.imports, { item: 'lime-slug', cap: Infinity }] },
      backend,
    );
    expect(imported.status).toBe('ok');
    expect(imported.starters).toBeUndefined();
    const capped = await solve(
      model,
      { ...base, imports: [...base.imports, { item: 'lime-slug', cap: 0 }] },
      backend,
    );
    expect(capped.status).toBe('unreachable');
  });

  test('slug recipes obey max tier: below 1-1 no Blue Slug breeding is used', async () => {
    const tier = model.recipes.find((x) => x.id === 'blue-slug-breeding')?.tier;
    expect(tier).toBe('1-1');
    const r = await solve(
      model,
      { targets: [{ item: 'blue-slug', rate: 3 }], recipes: { maxTier: '1-0' } },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(r.recipes.map((x) => x.id)).not.toContain('blue-slug-breeding');
    const open = await solve(model, { targets: [{ item: 'blue-slug', rate: 3 }] }, backend);
    expect(open.recipes.map((x) => x.id)).toContain('blue-slug-breeding');
  });
});
