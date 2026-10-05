import { describe, expect, test } from 'vitest';
import { createWorld, DEFAULT_FACTORY_ID } from './document';
import {
  addFactory,
  addGroup,
  addLink,
  groupAncestors,
  nextId,
  removeFactory,
  removeGroup,
  removeLink,
  renameFactory,
  renameGroup,
  setFactoryGroup,
  setGroupCollapsed,
  setGroupParent,
  updateLink,
  WorldEditError,
} from './editing';
import { migrateWorld } from './migrate';

/** A world with factories A and B and a pull link of Iron Plate A → B. */
function twoFactories() {
  let w = createWorld('test');
  const a = addFactory(w, 'A');
  const b = addFactory(a.world, 'B');
  w = b.world;
  const l = addLink(w, { from: a.id, to: b.id, item: 'iron-plate', mode: { kind: 'pull' } });
  return { world: l.world, a: a.id, b: b.id, link: l.id };
}

describe('ids', () => {
  test('nextId takes the smallest free number', () => {
    expect(nextId('link', [])).toBe('link-1');
    expect(nextId('link', ['link-1', 'link-3'])).toBe('link-2');
  });

  test('the same edits give the same ids, and ids are never reused across kinds', () => {
    const one = twoFactories();
    const two = twoFactories();
    expect(one).toEqual(two);
    expect([one.a, one.b, one.link]).toEqual(['factory-1', 'factory-2', 'link-1']);
    const g = addGroup(one.world, 'G');
    expect(g.id).toBe('group-1');
  });
});

describe('factories', () => {
  test('a new factory inherits every default and keeps the others unchanged', () => {
    const w = createWorld('test');
    const { world, id } = addFactory(w, '  Smelting  ');
    expect(world.factories[0]).toBe(w.factories[0]);
    expect(world.factories[1]).toEqual({
      id,
      name: 'Smelting',
      request: { targets: [] },
      unassignedImports: [],
      resources: {},
      priority: 0,
      notes: '',
    });
    expect(addFactory(w, '').world.factories[1]!.name).toBe('Factory 2');
  });

  test('removing a factory removes its links', () => {
    const { world, a } = twoFactories();
    const out = removeFactory(world, a);
    expect(out.factories.map((f) => f.id)).toEqual([DEFAULT_FACTORY_ID, 'factory-2']);
    expect(out.links).toEqual([]);
  });

  test('rename keeps the old name when the new one is blank', () => {
    const { world, a } = twoFactories();
    expect(renameFactory(world, a, 'Iron').factories[1]!.name).toBe('Iron');
    expect(renameFactory(world, a, '   ').factories[1]!.name).toBe('A');
  });

  test('unknown ids are errors', () => {
    const w = createWorld('test');
    expect(() => removeFactory(w, 'nope')).toThrow(WorldEditError);
    expect(() => setFactoryGroup(w, DEFAULT_FACTORY_ID, 'nope')).toThrow(/Unknown group/);
    expect(() => addFactory(w, 'x', 'nope')).toThrow(/Unknown group/);
  });
});

describe('groups', () => {
  test('create, nest, assign and collapse', () => {
    const { world: w0, a, b } = twoFactories();
    const outer = addGroup(w0, 'Outer');
    const inner = addGroup(outer.world, 'Inner', outer.id);
    let w = setFactoryGroup(inner.world, a, inner.id);
    w = setFactoryGroup(w, b, outer.id);
    w = setGroupCollapsed(w, outer.id, true);
    expect(w.groups).toEqual([
      { id: outer.id, name: 'Outer', collapsed: true },
      { id: inner.id, name: 'Inner', parentId: outer.id, collapsed: false },
    ]);
    expect(groupAncestors(w, inner.id)).toEqual([outer.id]);
    expect(setGroupCollapsed(w, outer.id, true)).toBe(w);
    expect(renameGroup(w, inner.id, 'Plates').groups[1]!.name).toBe('Plates');
    // Out of every group again.
    expect(setFactoryGroup(w, a, undefined).factories[1]).not.toHaveProperty('groupId');
  });

  test('nesting a group inside itself or a descendant is refused', () => {
    const outer = addGroup(createWorld('test'), 'Outer');
    const inner = addGroup(outer.world, 'Inner', outer.id);
    expect(() => setGroupParent(inner.world, outer.id, outer.id)).toThrow(/inside itself/);
    expect(() => setGroupParent(inner.world, outer.id, inner.id)).toThrow(/inside itself/);
    const top = setGroupParent(inner.world, inner.id, undefined);
    expect(top.groups[1]).not.toHaveProperty('parentId');
  });

  test('removing a group moves its members to its parent', () => {
    const { world: w0, a } = twoFactories();
    const outer = addGroup(w0, 'Outer');
    const mid = addGroup(outer.world, 'Mid', outer.id);
    const inner = addGroup(mid.world, 'Inner', mid.id);
    const w = setFactoryGroup(inner.world, a, mid.id);
    const out = removeGroup(w, mid.id);
    expect(out.groups.map((g) => [g.id, g.parentId])).toEqual([
      [outer.id, undefined],
      [inner.id, outer.id],
    ]);
    expect(out.factories.find((f) => f.id === a)!.groupId).toBe(outer.id);
    // A top-level group's members move to the top.
    const top = removeGroup(out, outer.id);
    expect(top.groups[0]).not.toHaveProperty('parentId');
    expect(top.factories.find((f) => f.id === a)).not.toHaveProperty('groupId');
  });
});

describe('links', () => {
  test('add, update and remove', () => {
    const { world, a, b, link } = twoFactories();
    expect(world.links).toEqual([
      { id: link, from: a, to: b, item: 'iron-plate', mode: { kind: 'pull' } },
    ]);
    const fixed = updateLink(world, link, {
      from: a,
      to: b,
      item: 'iron-plate',
      mode: { kind: 'fixed', rate: 30 },
      transport: { kind: 'belt', tier: 2 },
    });
    expect(fixed.links[0]).toEqual({
      id: link,
      from: a,
      to: b,
      item: 'iron-plate',
      mode: { kind: 'fixed', rate: 30 },
      transport: { kind: 'belt', tier: 2 },
    });
    expect(removeLink(fixed, link).links).toEqual([]);
  });

  test('bad links are refused', () => {
    const { world, a, b } = twoFactories();
    const spec = { from: a, to: b, item: 'iron-plate', mode: { kind: 'pull' as const } };
    expect(() => addLink(world, { ...spec, to: a })).toThrow(/two different factories/);
    expect(() => addLink(world, { ...spec, to: 'nope' })).toThrow(/Unknown factory/);
    expect(() => addLink(world, { ...spec, item: '' })).toThrow(/needs an item/);
    expect(() => addLink(world, { ...spec, mode: { kind: 'fixed', rate: -1 } })).toThrow(/rate/);
    expect(() => updateLink(world, 'nope', spec)).toThrow(/Unknown link/);
  });

  test('an edited world is still a current, valid document', () => {
    const { world } = twoFactories();
    const g = addGroup(world, 'G');
    expect(migrateWorld(JSON.parse(JSON.stringify(g.world)))).toEqual(g.world);
  });
});
