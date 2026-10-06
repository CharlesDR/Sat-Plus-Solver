import type { Model } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import { factorySolveRequest, recipeFilter, tweakedImports, type World } from './document';
import { addTweak, removeTweak, revertTweaks, undoTweak, WorldEditError } from './editing';
import { resolveWorld } from './resolve';
import { buildWorld } from './testing';
import type { SolveFactory } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();
const solveFactory: SolveFactory = (r) => solve(model, r, backend);
const nodes = { nodes: [] };

/** Factory "a" making 40 Screw/min, with alternates off. */
const screws = (): World =>
  buildWorld([{ id: 'a', targets: [{ item: 'screw', rate: 40 }], request: { alternates: false } }]);

const recipesUsed = async (w: World) => {
  const r = await resolveWorld(w, model, solveFactory);
  const f = r.factories.find((x) => x.id === 'a')!;
  expect(f.status).toBe('ok');
  return f.result.recipes.map((x) => x.id).sort();
};

describe('plan tweaks (A35)', () => {
  test('a ban, a swap and an import apply over the toggles, later tweaks winning', () => {
    let w = screws();
    w = addTweak(w, 'a', { kind: 'ban', recipe: 'iron-rod' });
    expect(recipeFilter(w, w.factories[0]!).exclude).toEqual(['iron-rod']);
    w = addTweak(w, 'a', { kind: 'swap', from: 'screw', to: 'cast-screw' });
    expect(recipeFilter(w, w.factories[0]!)).toEqual({
      alternates: false,
      exclude: ['iron-rod', 'screw'],
      include: ['cast-screw'],
    });
    // A later swap back turns the first swap around.
    w = addTweak(w, 'a', { kind: 'swap', from: 'cast-screw', to: 'screw' });
    expect(recipeFilter(w, w.factories[0]!)).toEqual({
      alternates: false,
      exclude: ['cast-screw', 'iron-rod'],
      include: ['screw'],
    });
    // Without tweaks, the factory's own filter.
    expect(recipeFilter(w, w.factories[0]!, { tweaks: false })).toEqual({
      alternates: false,
      exclude: [],
    });
  });

  test('an import tweak lifts an existing cap and adds a missing import', () => {
    let w = buildWorld([
      {
        id: 'a',
        unassignedImports: [
          { item: 'iron-ore', cap: 30 },
          { item: 'coal', cap: 5 },
        ],
      },
    ]);
    w = addTweak(w, 'a', { kind: 'import', item: 'iron-ore' });
    w = addTweak(w, 'a', { kind: 'import', item: 'iron-rod' });
    expect(tweakedImports(w.factories[0]!)).toEqual([
      { item: 'iron-ore' },
      { item: 'coal', cap: 5 },
      { item: 'iron-rod' },
    ]);
    expect(factorySolveRequest(w, nodes, 'a').imports).toEqual([
      { item: 'iron-ore', cap: Infinity },
      { item: 'coal', cap: 5 },
      { item: 'iron-rod', cap: Infinity },
    ]);
  });

  test('tweaks change the solved plan', async () => {
    const w = screws();
    expect(await recipesUsed(w)).toEqual(['iron-ingot', 'iron-rod', 'mine-iron-ore', 'screw']);
    const swapped = addTweak(w, 'a', { kind: 'swap', from: 'screw', to: 'cast-screw' });
    const used = await recipesUsed(swapped);
    expect(used).toContain('cast-screw');
    expect(used).not.toContain('screw');
    expect(used).not.toContain('iron-rod');
    const imported = addTweak(w, 'a', { kind: 'import', item: 'iron-rod' });
    const viaImport = await recipesUsed(imported);
    expect(viaImport).toEqual(['screw']);
  });

  test('undo walks back 150 tweaks one at a time, and revert all gives the untweaked request', () => {
    const base = screws();
    let w = base;
    const steps: World[] = [w];
    for (let k = 0; k < 150; k++) {
      w = addTweak(w, 'a', { kind: 'ban', recipe: `r-${k}` });
      steps.push(w);
    }
    expect(w.factories[0]!.tweaks).toHaveLength(150);
    for (let k = 150; k > 0; k--) {
      w = undoTweak(w, 'a');
      expect(w.factories[0]!.tweaks).toEqual(steps[k - 1]!.factories[0]!.tweaks);
    }
    expect(undoTweak(w, 'a')).toBe(w);
    const reverted = revertTweaks(steps[150]!, 'a');
    expect(reverted.factories[0]).toEqual(base.factories[0]);
    expect(factorySolveRequest(reverted, nodes, 'a')).toEqual(
      factorySolveRequest(base, nodes, 'a'),
    );
    expect(revertTweaks(base, 'a')).toBe(base);
  });

  test('repeating the last tweak changes nothing; one tweak can be removed', () => {
    let w = addTweak(screws(), 'a', { kind: 'ban', recipe: 'iron-rod' });
    expect(addTweak(w, 'a', { kind: 'ban', recipe: 'iron-rod' })).toBe(w);
    w = addTweak(w, 'a', { kind: 'import', item: 'iron-ingot' });
    w = removeTweak(w, 'a', 0);
    expect(w.factories[0]!.tweaks).toEqual([{ kind: 'import', item: 'iron-ingot' }]);
    expect(() => removeTweak(w, 'a', 1)).toThrow(WorldEditError);
    expect(() => addTweak(w, 'a', { kind: 'swap', from: 'screw', to: 'screw' })).toThrow(
      WorldEditError,
    );
    expect(() => addTweak(w, 'nope', { kind: 'ban', recipe: 'screw' })).toThrow(WorldEditError);
  });

  test('the max-tier filter still beats a swap (A23)', () => {
    let w = buildWorld([{ id: 'a', request: { maxTier: '0-0' } }]);
    w = addTweak(w, 'a', { kind: 'swap', from: 'screw', to: 'cast-screw' });
    expect(recipeFilter(w, w.factories[0]!)).toMatchObject({
      include: ['cast-screw'],
      maxTier: '0-0',
    });
  });
});
