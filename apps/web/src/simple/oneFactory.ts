/**
 * Simple mode (A72) plans one factory. Its world is a one-factory World, so
 * the solver, checks and save format are the full planner's. A world that
 * arrives with more (a file, a slot, the sample) keeps its first top-level
 * factory, with that factory's links turned into targets and imports.
 */
import { addFactory, extractFactory, type World } from '@sps/world';

export type OneFactory =
  { kind: 'added'; world: World } | { kind: 'kept'; world: World; kept: string; dropped: number };

/** The one-factory world for `world`, or `undefined` when it already is one. */
export function keepOneFactory(world: World): OneFactory | undefined {
  const [first, ...rest] = world.factories;
  if (!first) return { kind: 'added', world: addFactory(world, '').world };
  if (
    rest.length === 0 &&
    world.links.length === 0 &&
    world.groups.length === 0 &&
    first.groupId === undefined &&
    first.parentId === undefined &&
    first.collapsed === undefined
  )
    return undefined;
  const kept = world.factories.find((f) => f.parentId === undefined) ?? first;
  return {
    kind: 'kept',
    world: { ...extractFactory(world, kept.id), meta: structuredClone(world.meta) },
    kept: kept.name,
    dropped: rest.length,
  };
}
