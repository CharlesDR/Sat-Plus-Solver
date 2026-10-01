import type { Model } from '@sps/data';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../../fixtures/vanilla-mini/model.json';
import { createHighsBackend } from '../lp/highs';
import { aboveTier, compareTiers, filterRecipes, parseTier, recipeExclusion } from './recipes';
import { solve } from './solve';
import type { SolveRequest } from './types';

const mini = vanillaMini as Model;
const backend = createHighsBackend();
const ids = (r: { recipes: { id: string }[] }) => r.recipes.map((x) => x.id);

/** vanilla-mini with tiers, so the tier filter has something to cut. */
const tiered: Model = {
  ...mini,
  recipes: mini.recipes.map((r) => ({
    ...r,
    tier:
      { 'steel-ingot': '3-1', 'steel-beam': '3-1', 'solid-steel-ingot': '3-2', screw: '1-0' }[
        r.id
      ] ?? r.tier,
  })),
};

describe('tiers', () => {
  test('parse and order major first', () => {
    expect(parseTier('3-2')).toEqual([3, 2]);
    expect(parseTier('10-0')).toEqual([10, 0]);
    expect(parseTier('3')).toBeUndefined();
    expect(parseTier('a-b')).toBeUndefined();
    const sorted = ['1-0', '0-6', '10-0', '2-10', '2-3'].sort(compareTiers);
    expect(sorted).toEqual(['0-6', '1-0', '2-3', '2-10', '10-0']);
  });

  test('0-0 and unparseable tiers are never above a limit', () => {
    expect(aboveTier('0-0', '0-1')).toBe(false);
    expect(aboveTier('?', '0-1')).toBe(false);
    expect(aboveTier('3-2', '3-1')).toBe(true);
    expect(aboveTier('3-1', '3-1')).toBe(false);
    expect(aboveTier('9-9', undefined)).toBe(false);
  });
});

describe('recipe filter', () => {
  const alt = { id: 'a', alternate: true, tier: '2-0' };
  const std = { id: 's', alternate: false, tier: '4-0' };

  test('alternates are off by default; include enables one; exclude wins', () => {
    expect(recipeExclusion(alt, undefined)).toBe('alternate');
    expect(recipeExclusion(std, undefined)).toBeUndefined();
    expect(recipeExclusion(alt, { include: ['a'] })).toBeUndefined();
    expect(recipeExclusion(alt, { alternates: true })).toBeUndefined();
    expect(recipeExclusion(alt, { alternates: true, include: ['a'], exclude: ['a'] })).toBe(
      'excluded',
    );
    expect(recipeExclusion(std, { maxTier: '3-6' })).toBe('tier');
    // The tier limit holds even for an explicitly included alternate.
    expect(recipeExclusion(alt, { include: ['a'], maxTier: '1-0' })).toBe('tier');
  });

  test('filterRecipes agrees with recipeExclusion', () => {
    const filter = { include: ['cast-screw'], exclude: ['wire'], maxTier: '3-1' };
    const { enabled, disabled } = filterRecipes(tiered.recipes, filter);
    expect(enabled.length + disabled.length).toBe(tiered.recipes.length);
    for (const r of enabled) expect(recipeExclusion(r, filter)).toBeUndefined();
    for (const r of disabled) expect(recipeExclusion(r, filter)).toBeDefined();
    expect(disabled.map((r) => r.id).sort()).toEqual(
      ['iron-wire', 'solid-steel-ingot', 'wire'].sort(),
    );
  });
});

describe('solve with recipe toggles (M6)', () => {
  const screws: SolveRequest = { targets: [{ item: 'screw', rate: 40 }] };

  test('an included alternate becomes eligible and is used when it is better', async () => {
    // Under scarcity, Iron Wire (iron instead of scarcer copper) beats Wire.
    const cable: SolveRequest = { targets: [{ item: 'cable', rate: 30 }], objective: 'scarcity' };
    const off = await solve(mini, cable, backend);
    expect(ids(off)).not.toContain('iron-wire');
    const on = await solve(mini, { ...cable, recipes: { include: ['iron-wire'] } }, backend);
    expect(on.status).toBe('ok');
    expect(ids(on)).toContain('iron-wire');
    expect(on.objectiveValue!).toBeLessThan(off.objectiveValue!);
    // Other alternates stay off.
    const s = await solve(mini, { ...screws, recipes: { include: ['iron-wire'] } }, backend);
    expect(ids(s)).not.toContain('cast-screw');
  });

  test('an included alternate that is not better is left unused', async () => {
    // Cast Screw needs iron ingots; with only iron rods imported, standard Screw is the way.
    const r = await solve(
      mini,
      {
        ...screws,
        imports: [{ item: 'iron-rod', cap: Infinity }],
        nodeBudget: {},
        recipes: { include: ['cast-screw'] },
      },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(ids(r)).toEqual(['screw']);
  });

  test('the tier filter leaves out recipes above the tier', async () => {
    const beams: SolveRequest = { targets: [{ item: 'steel-beam', rate: 15 }] };
    expect((await solve(tiered, beams, backend)).status).toBe('ok');
    const r = await solve(tiered, { ...beams, recipes: { maxTier: '3-0' } }, backend);
    expect(r.status).toBe('unreachable');
    const d = r.diagnostics[0]!;
    expect(d.code).toBe('unreachable');
    if (d.code === 'unreachable') expect(d.fixes).toContain('steel-beam');

    const s = await solve(
      tiered,
      { ...beams, recipes: { alternates: true, maxTier: '3-1' } },
      backend,
    );
    expect(s.status).toBe('ok');
    expect(ids(s)).not.toContain('solid-steel-ingot');
    for (const u of s.recipes) {
      const tier = tiered.recipes.find((x) => x.id === u.id)!.tier;
      expect(aboveTier(tier, '3-1')).toBe(false);
    }
  });

  test('a malformed max tier is rejected', async () => {
    const r = await solve(mini, { ...screws, recipes: { maxTier: 'tier 3' } }, backend);
    expect(r.status).toBe('error');
    expect(r.diagnostics[0]!.code).toBe('invalid-request');
  });

  test('a node budget below usage gives the infeasibility diagnostic', async () => {
    const plate: SolveRequest = { targets: [{ item: 'iron-plate', rate: 60 }] };
    const ok = await solve(mini, plate, backend);
    const used = ok.nodes.find((n) => n.node === 'node:iron-ore:normal')!.used;
    expect(used).toBeGreaterThan(1);
    const r = await solve(
      mini,
      {
        ...plate,
        nodeBudget: Object.fromEntries(
          mini.nodes.map((n) => [n.id, n.id === 'node:iron-ore:normal' ? 1 : 0]),
        ),
      },
      backend,
    );
    expect(r.status).toBe('infeasible');
    const d = r.diagnostics[0]!;
    expect(d.code).toBe('infeasible');
    if (d.code !== 'infeasible') return;
    expect(d.relaxations.length).toBeGreaterThan(0);
    expect(d.message).toMatch(/needs/i);
  });
});
