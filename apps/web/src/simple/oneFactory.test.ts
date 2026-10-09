import { addFactory, addLink, createWorld, parseWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import sample from '../../../../examples/world.json';
import { keepOneFactory } from './oneFactory';

describe('keepOneFactory (A72)', () => {
  test('an empty world gets one factory', () => {
    const out = keepOneFactory({ ...createWorld(), factories: [] });
    expect(out?.kind).toBe('added');
    expect(out?.world.factories).toHaveLength(1);
    expect(keepOneFactory(out!.world)).toBeUndefined();
  });

  test('a one-factory world is left alone', () => {
    expect(keepOneFactory(createWorld())).toBeUndefined();
    expect(
      keepOneFactory(addFactory(createWorld(), 'Smelter').world)?.world.factories,
    ).toHaveLength(1);
  });

  test('a bigger world keeps its first top-level factory, links as targets and imports', () => {
    const world = parseWorld(JSON.stringify(sample));
    world.meta.name = 'Sample';
    const out = keepOneFactory(world);
    if (out?.kind !== 'kept') throw new Error('expected a trimmed world');
    const first = world.factories.find((f) => f.parentId === undefined)!;
    expect(out.kept).toBe(first.name);
    expect(out.dropped).toBe(world.factories.length - 1);
    expect(out.world.factories.map((f) => f.id)).toEqual([first.id]);
    expect(out.world.links).toEqual([]);
    expect(out.world.groups).toEqual([]);
    expect(out.world.meta.name).toBe('Sample');
    expect(keepOneFactory(out.world)).toBeUndefined();
  });

  test('two linked factories keep one, with no links', () => {
    const a = addFactory({ ...createWorld(), factories: [] }, 'A');
    const b = addFactory(a.world, 'B');
    const world = addLink(b.world, {
      from: a.id,
      to: b.id,
      item: 'iron-plate',
      mode: { kind: 'pull' },
    }).world;
    expect(keepOneFactory(world)?.world.factories).toHaveLength(1);
  });
});
