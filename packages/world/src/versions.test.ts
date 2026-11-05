import type { Model } from '@sps/data';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import type { World } from './document';
import { buildWorld } from './testing';
import { dismissVersionNote, switchModVersion } from './versions';

const before = { ...(vanillaMini as Model), meta: { ...vanillaMini.meta, dataHash: 'old' } };
/** The next version: Cast Screw is gone and Iron Plate makes more per machine. */
const after: Model = {
  ...before,
  meta: { ...before.meta, dataHash: 'new' },
  recipes: before.recipes
    .filter((r) => r.id !== 'cast-screw')
    .map((r) =>
      r.id === 'iron-plate'
        ? { ...r, outputs: r.outputs.map((o) => ({ ...o, rate: o.rate * 2 })) }
        : r.id === 'iron-rod'
          ? { ...r, tier: '9-9' }
          : r,
    ),
};

/** Two factories naming Cast Screw in every way a world can, and "b" in manual mode. */
function world(): World {
  const w = buildWorld([
    {
      id: 'a',
      targets: [{ item: 'screw', rate: 10 }],
      request: { recipes: { 'cast-screw': true } },
    },
    { id: 'b', targets: [{ item: 'iron-plate', rate: 20 }] },
  ]);
  w.meta.modVersion = '1.0';
  w.meta.dataHash = 'old';
  w.defaults.recipes = { 'cast-screw': false, 'iron-wire': true };
  const [a, b] = w.factories as [World['factories'][0], World['factories'][0]];
  a.tweaks = [
    { kind: 'swap', from: 'screw', to: 'cast-screw' },
    { kind: 'ban', recipe: 'iron-wire' },
    { kind: 'import', item: 'iron-rod' },
  ];
  a.areas = { moves: { 'recipe:cast-screw': 'parts', 'recipe:screw': 'parts', 'sub:b': 'x' } };
  b.manual = {
    enabled: true,
    frozen: [
      { recipe: 'cast-screw', machines: 1 },
      { recipe: 'iron-ingot', machines: 2 },
      { recipe: 'iron-plate', machines: 3 },
      { recipe: 'iron-rod', machines: 1 },
    ],
    edits: [{ recipe: 'iron-plate', machines: 4 }],
    versionNote: { version: '0.9', recipes: ['iron-ingot'] },
  };
  return w;
}

describe('switchModVersion (A111)', () => {
  test('names the new version and adopts its data hash', () => {
    const out = switchModVersion(world(), '2.0', after, before).world;
    expect(out.meta).toMatchObject({ modVersion: '2.0', dataHash: 'new' });
  });

  test('drops every reference to a recipe the new version lacks, and lists each', () => {
    const w = world();
    const copy = JSON.stringify(w);
    const { world: out, dropped } = switchModVersion(w, '2.0', after, before);
    expect(JSON.stringify(w)).toBe(copy);
    expect(out.defaults.recipes).toEqual({ 'iron-wire': true });
    const [a, b] = out.factories;
    expect(a!.request.recipes).toEqual({});
    expect(a!.tweaks).toEqual([
      { kind: 'ban', recipe: 'iron-wire' },
      { kind: 'import', item: 'iron-rod' },
    ]);
    expect(a!.areas?.moves).toEqual({ 'recipe:screw': 'parts', 'sub:b': 'x' });
    expect(b!.manual?.frozen.map((e) => e.recipe)).toEqual([
      'iron-ingot',
      'iron-plate',
      'iron-rod',
    ]);
    const named = { recipe: 'cast-screw', name: 'Alternate: Cast Screw' };
    expect(dropped).toEqual([
      { ...named, kind: 'toggle' },
      { ...named, kind: 'toggle', factoryId: 'a' },
      { ...named, kind: 'tweak', factoryId: 'a' },
      { ...named, kind: 'area', factoryId: 'a' },
      { ...named, kind: 'manual', factoryId: 'b' },
    ]);
  });

  test('a manual factory keeps its counts, with a note naming only recipes whose flows changed', () => {
    const { world: out, changed } = switchModVersion(world(), '2.0', after, before);
    const manual = out.factories[1]!.manual!;
    expect(manual.edits).toEqual([{ recipe: 'iron-plate', machines: 4 }]);
    // Iron Rod's tier moved, but not its flows; the old note is replaced.
    expect(manual.versionNote).toEqual({ version: '2.0', recipes: ['iron-plate'] });
    expect(changed).toEqual([{ factoryId: 'b', recipes: ['iron-plate'] }]);
    expect(dismissVersionNote(out, 'b').factories[1]!.manual).not.toHaveProperty('versionNote');
  });

  test('without the old model, dropped recipes go by id and manual plans get no note', () => {
    const { world: out, dropped, changed } = switchModVersion(world(), '2.0', after);
    expect(dropped[0]).toEqual({ recipe: 'cast-screw', name: 'cast-screw', kind: 'toggle' });
    expect(changed).toEqual([]);
    expect(out.factories[1]!.manual).not.toHaveProperty('versionNote');
  });

  test('a factory in solver mode gets no note, and the same version is no change', () => {
    const w = world();
    w.factories[1]!.manual!.enabled = false;
    expect(switchModVersion(w, '2.0', after, before).changed).toEqual([]);
    expect(switchModVersion(w, '1.0', after, before)).toEqual({
      world: w,
      dropped: [],
      changed: [],
    });
  });
});
