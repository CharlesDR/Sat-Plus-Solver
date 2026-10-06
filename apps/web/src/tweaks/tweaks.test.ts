import type { Model } from '@sps/data';
import { factoryGraph, recipeNodeId } from '@sps/graph';
import { createHighsBackend, solve } from '@sps/solver';
import { createFactory, createWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import miniJson from '../../../../fixtures/vanilla-mini/model.json';
import { modelCatalog, modelLabels } from '../solver/service';
import { previewDelta, swapCandidates, tweakLabel, tweakTarget, type Baseline } from './tweaks';

const mini = miniJson as unknown as Model;
const catalog = modelCatalog({
  ...mini,
  // Lift Cast Screw above tier 0-0 so the max-tier filter can block it.
  recipes: mini.recipes.map((r) => (r.id === 'cast-screw' ? { ...r, tier: '3-1' } : r)),
});
const byId = new Map(catalog.recipes.map((r) => [r.id, r]));
const names = {
  item: (id: string) => catalog.items.find((i) => i.id === id)?.name ?? id,
  recipe: (id: string) => byId.get(id)?.name ?? id,
};

describe('plan tweak view (A35)', () => {
  test('recipe and resource nodes are tweak targets with their main product; others are not', async () => {
    const r = await solve(mini, { targets: [{ item: 'screw', rate: 40 }] }, createHighsBackend());
    const g = factoryGraph(r, modelLabels(mini));
    const node = (id: string) => g.nodes.find((n) => n.id === id);
    expect(tweakTarget(node(recipeNodeId('screw')), byId)).toEqual({
      recipe: 'screw',
      name: 'Screw',
      product: 'screw',
    });
    expect(tweakTarget(node(recipeNodeId('mine-iron-ore')), byId)?.product).toBe('iron-ore');
    expect(tweakTarget(node('target:screw'), byId)).toBeUndefined();
    expect(tweakTarget(undefined, byId)).toBeUndefined();
  });

  test('swap candidates make the same product; the max tier blocks one', () => {
    const w = createWorld();
    const f = w.factories[0]!;
    const target = { recipe: 'screw', name: 'Screw', product: 'screw' };
    expect(swapCandidates(w, f, target, catalog.recipes)).toEqual([
      { recipe: byId.get('cast-screw') },
    ]);
    const capped = { ...f, request: { ...f.request, maxTier: '2-0' } };
    expect(swapCandidates(w, capped, target, catalog.recipes)).toEqual([
      { recipe: byId.get('cast-screw'), blocked: 'tier' },
    ]);
    expect(swapCandidates(w, createFactory('x', 'X'), target, [])).toEqual([]);
  });

  test('tweaks read as sentences', () => {
    expect(tweakLabel({ kind: 'ban', recipe: 'screw' }, names)).toBe('Don’t use Screw');
    expect(tweakLabel({ kind: 'swap', from: 'screw', to: 'cast-screw' }, names)).toBe(
      'Screw → Alternate: Cast Screw',
    );
    expect(tweakLabel({ kind: 'import', item: 'iron-rod' }, names)).toBe('Import Iron Rod');
  });

  test('a preview reads as machines, power and the raw resources that move most', () => {
    const base: Baseline = {
      status: 'ok',
      machines: 10,
      consumptionMW: 40,
      extraction: [{ item: 'iron-ore', rate: 60 }],
    };
    const same = { ...base, recipe: 'x' };
    expect(previewDelta(base, same, names)).toBe('Same as now');
    expect(
      previewDelta(
        base,
        {
          recipe: 'x',
          status: 'ok',
          machines: 7,
          consumptionMW: 52.5,
          extraction: [
            { item: 'coal', rate: 15 },
            { item: 'iron-ore', rate: 30 },
          ],
        },
        names,
      ),
    ).toBe('−3 machines, +12.5 MW, −30 Iron Ore/min, +15 Coal/min');
    expect(previewDelta(base, { ...same, machines: 11 }, names)).toBe('+1 machine');
    expect(previewDelta(base, { ...same, status: 'infeasible' }, names)).toBe(
      'Can’t meet the targets',
    );
    expect(previewDelta(base, { ...same, status: 'short' }, names)).toBe('an import runs short');
  });
});
