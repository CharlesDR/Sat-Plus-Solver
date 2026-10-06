import { DEFAULT_FACTORY_ID, WORLD_VERSION, createFactory, createWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import { createWorldStore, effectiveSettings, type Scope } from './store';

const F = DEFAULT_FACTORY_ID;
const here: Scope = { kind: 'factory', id: F };
const everywhere: Scope = { kind: 'world' };

/** A store over a world with the implicit factory plus factory `b`. */
function twoFactories() {
  const w = createWorld();
  w.factories.push(createFactory('b', 'B'));
  return createWorldStore(w);
}

describe('world store', () => {
  test('starts as a one-factory World document', () => {
    const { world } = createWorldStore().getState();
    expect(world).toEqual(createWorld());
    expect(world.meta.v).toBe(WORLD_VERSION);
    expect(world.factories).toHaveLength(1);
  });

  test('setTargets replaces the targets immutably', () => {
    const store = createWorldStore();
    const before = store.getState().world;
    const targets = [
      { item: 'iron-plate', rate: 60 },
      { item: 'screw', rate: 10 },
    ];
    store.getState().setTargets(F, targets);
    const after = store.getState().world;
    expect(after).not.toBe(before);
    expect(before.factories[0]!.request.targets).toEqual([]);
    expect(after.factories[0]!.request.targets).toEqual(targets);
    expect(after.factories[0]!.request.targets[0]).not.toBe(targets[0]);
    expect(after.defaults).toBe(before.defaults);
    store.getState().setTargets(F, []);
    expect(store.getState().world.factories[0]!.request.targets).toEqual([]);
  });

  test('edits to an unknown factory throw', () => {
    const s = createWorldStore().getState();
    expect(() => s.setTargets('nope', [])).toThrow(/Unknown factory/);
    expect(() => s.setSetting({ kind: 'factory', id: 'nope' }, 'alternates', true)).toThrow(
      /Unknown factory/,
    );
  });

  test('a factory override is set, read back, and reset to inherit', () => {
    const store = createWorldStore();
    expect(effectiveSettings(store.getState().world, F).overridden.alternates).toBe(false);
    store.getState().setSetting(here, 'alternates', true);
    store.getState().setSetting(here, 'objectives', ['machines', 'resources']);
    store.getState().setSetting(here, 'maxTier', null);
    let eff = effectiveSettings(store.getState().world, F);
    expect(eff.values).toMatchObject({
      alternates: true,
      objectives: ['machines', 'resources'],
      maxTier: null,
    });
    expect(eff.overridden).toMatchObject({ alternates: true, objectives: true, maxTier: true });
    expect(store.getState().world.defaults.alternates).toBe(false);

    store.getState().setSetting(here, 'alternates', undefined);
    eff = effectiveSettings(store.getState().world, F);
    expect(eff.overridden.alternates).toBe(false);
    expect(store.getState().world.factories[0]!.request).not.toHaveProperty('alternates');
  });

  test('world defaults apply where a factory does not override them', () => {
    const store = twoFactories();
    store.getState().setSetting(here, 'wholeMachines', false);
    store.getState().setSetting(everywhere, 'wholeMachines', true);
    store.getState().setSetting(everywhere, 'maxTier', '3-0');
    const w = store.getState().world;
    expect(effectiveSettings(w, F).values.wholeMachines).toBe(false);
    expect(effectiveSettings(w, 'b').values.wholeMachines).toBe(true);
    expect(effectiveSettings(w, 'b').values.maxTier).toBe('3-0');
    expect(() => store.getState().setSetting(everywhere, 'alternates', undefined)).toThrow();
  });

  test('tolerance clamps to 0.01%–90%, and the stack must not be empty', () => {
    const store = createWorldStore();
    store.getState().setSetting(here, 'tolerance', 5);
    expect(store.getState().world.factories[0]!.request.tolerance).toBe(0.9);
    store.getState().setSetting(everywhere, 'tolerance', 0);
    expect(store.getState().world.defaults.tolerance).toBe(0.0001);
    expect(() => store.getState().setSetting(here, 'objectives', [])).toThrow(/at least one/);
    store.getState().setSetting(here, 'objectives', ['power', 'power', 'machines']);
    expect(store.getState().world.factories[0]!.request.objectives).toEqual(['power', 'machines']);
  });

  test('recipe toggles: per factory, per world, and reset', () => {
    const store = twoFactories();
    store.getState().setRecipes(here, ['cast-screw', 'iron-wire'], true);
    store.getState().setRecipes(everywhere, ['wire'], false);
    let w = store.getState().world;
    expect(w.factories[0]!.request.recipes).toEqual({ 'cast-screw': true, 'iron-wire': true });
    expect(w.defaults.recipes).toEqual({ wire: false });
    // The other factory is untouched (same object).
    const b = w.factories[1];
    store.getState().setRecipes(here, ['cast-screw'], undefined);
    w = store.getState().world;
    expect(w.factories[1]).toBe(b);
    expect(w.factories[0]!.request.recipes).toEqual({ 'iron-wire': true });
    store.getState().setRecipes(here, ['iron-wire'], undefined);
    expect(store.getState().world.factories[0]!.request).not.toHaveProperty('recipes');
  });

  test('imports and resource limits are per factory', () => {
    const store = twoFactories();
    const b = store.getState().world.factories[1];
    store.getState().setUnassignedImports(F, [{ item: 'iron-ingot' }, { item: 'screw', cap: 5 }]);
    const limits = { 'iron-ore': { enabled: true, max: 120 }, water: { enabled: false } };
    store.getState().setResources(F, limits);
    const w = store.getState().world;
    expect(w.factories[0]!.unassignedImports).toEqual([
      { item: 'iron-ingot' },
      { item: 'screw', cap: 5 },
    ]);
    expect(w.factories[0]!.resources).toEqual(limits);
    expect(w.factories[0]!.resources['iron-ore']).not.toBe(limits['iron-ore']);
    expect(w.factories[1]).toBe(b);
    store.getState().setResources(F, {});
    expect(store.getState().world.factories[0]!.resources).toEqual({});
  });

  test('attachData fills an empty hash, keeps a matching one, and flags a mismatch', () => {
    const store = createWorldStore();
    store.getState().attachData('h1');
    expect(store.getState().world.meta.dataHash).toBe('h1');
    const world = store.getState().world;
    store.getState().attachData('h1');
    expect(store.getState().world).toBe(world);
    expect(store.getState().dataHashMismatch).toBeUndefined();

    store.getState().attachData('h2');
    expect(store.getState().world.meta.dataHash).toBe('h1');
    expect(store.getState().dataHashMismatch).toEqual({ world: 'h1', model: 'h2' });
  });

  test('loadWorld replaces the document and re-checks its data hash (M9)', () => {
    const store = createWorldStore();
    // Before the model is known, a loaded world is taken as is.
    const early = createWorld('old');
    store.getState().loadWorld(early);
    expect(store.getState().world).toBe(early);
    expect(store.getState().dataHashMismatch).toBeUndefined();
    store.getState().attachData('h1');
    expect(store.getState().dataHashMismatch).toEqual({ world: 'old', model: 'h1' });

    const same = createWorld('h1');
    store.getState().loadWorld(same);
    expect(store.getState().world).toBe(same);
    expect(store.getState().dataHashMismatch).toBeUndefined();

    store.getState().loadWorld(createWorld(''));
    expect(store.getState().world.meta.dataHash).toBe('h1');

    const other = createWorld('h0');
    other.factories[0]!.name = 'Imported';
    store.getState().loadWorld(other);
    expect(store.getState().world).toBe(other);
    expect(store.getState().dataHashMismatch).toEqual({ world: 'h0', model: 'h1' });
  });
});

describe('world editing (M8)', () => {
  test('factories, groups and links; unchanged factories keep their identity', () => {
    const store = createWorldStore();
    const s = store.getState();
    const main = store.getState().world.factories[0];
    const a = s.addFactory('A');
    const b = s.addFactory('B');
    const link = s.addLink({ from: a, to: b, item: 'iron-plate', mode: { kind: 'pull' } });
    const g = s.addGroup('Iron');
    s.setFactoryGroup(a, g);
    s.setFactoryGroup(b, g);
    s.setGroupCollapsed(g, true);
    const { world } = store.getState();
    expect(world.factories[0]).toBe(main);
    expect(world.factories.map((f) => [f.name, f.groupId])).toEqual([
      ['Factory', undefined],
      ['A', g],
      ['B', g],
    ]);
    expect(world.links).toEqual([
      { id: link, from: a, to: b, item: 'iron-plate', mode: { kind: 'pull' } },
    ]);
    expect(world.groups).toEqual([{ id: g, name: 'Iron', collapsed: true }]);

    s.updateLink(link, { from: a, to: b, item: 'iron-plate', mode: { kind: 'fixed', rate: 5 } });
    expect(store.getState().world.links[0]!.mode).toEqual({ kind: 'fixed', rate: 5 });
    s.removeFactory(a);
    expect(store.getState().world.links).toEqual([]);
  });

  test('a bad edit throws and leaves the world unchanged', () => {
    const store = createWorldStore();
    const before = store.getState().world;
    expect(() =>
      store.getState().addLink({ from: F, to: F, item: 'iron-plate', mode: { kind: 'pull' } }),
    ).toThrow(/two different factories/);
    expect(store.getState().world).toBe(before);
  });

  test('replaceWorld swaps the document', () => {
    const store = createWorldStore();
    const next = createWorld('other');
    store.getState().replaceWorld(next);
    expect(store.getState().world).toBe(next);
  });

  test('plan tweaks: add, undo, remove and revert all, per factory (A35)', () => {
    const store = twoFactories();
    const s = () => store.getState();
    const tweaks = (id: string) => s().world.factories.find((f) => f.id === id)!.tweaks;
    const before = s().world;
    s().addTweak(F, { kind: 'ban', recipe: 'screw' });
    s().addTweak(F, { kind: 'import', item: 'iron-rod' });
    s().addTweak(F, { kind: 'swap', from: 'iron-plate', to: 'alternate-coated-iron-plate' });
    expect(tweaks(F)).toHaveLength(3);
    expect(tweaks('b')).toEqual([]);
    expect(s().world.factories[1]).toBe(before.factories[1]);
    s().undoTweak(F);
    expect(tweaks(F)).toEqual([
      { kind: 'ban', recipe: 'screw' },
      { kind: 'import', item: 'iron-rod' },
    ]);
    s().removeTweak(F, 0);
    expect(tweaks(F)).toEqual([{ kind: 'import', item: 'iron-rod' }]);
    s().revertTweaks(F);
    expect(s().world.factories[0]).toEqual(before.factories[0]);
  });

  test('manual mode: enter, edit, undo, revert, leave and discard (A36)', () => {
    const store = twoFactories();
    const s = () => store.getState();
    const manual = () => s().world.factories[0]!.manual;
    const before = s().world.factories[0];
    s().enterManual(F, [{ recipe: 'iron-plate', machines: 3 }]);
    s().setManualCount(F, 'iron-plate', 4);
    s().setManualCount(F, 'screw', 1);
    expect(manual()!.edits).toHaveLength(2);
    s().undoManual(F);
    expect(manual()!.edits).toEqual([{ recipe: 'iron-plate', machines: 4 }]);
    s().revertManual(F);
    expect(manual()).toEqual({
      enabled: true,
      frozen: [{ recipe: 'iron-plate', machines: 3 }],
      edits: [],
    });
    s().leaveManual(F);
    expect(manual()!.enabled).toBe(false);
    s().discardManual(F);
    expect(s().world.factories[0]).toEqual(before);
    expect(s().world.factories[1]!.manual).toBeUndefined();
  });
});
