import type { VersionSwitch, World } from '@sps/world';

/** Most dropped settings a note names; the rest are counted. */
const NAMED = 4;

/**
 * The note after a world moves to SF+ `to` (A111): every factory re-solves,
 * what was dropped for naming a recipe the version lacks, and which manual
 * factories kept counts for recipes that changed. `why` leads, when given.
 */
export function switchNote(
  to: string,
  switched: Omit<VersionSwitch, 'world'>,
  world: World,
  why?: string,
): string {
  const name = new Map(world.factories.map((f) => [f.id, f.name]));
  const out = [`${why ? `${why} ` : ''}Now on SF+ ${to}; every factory re-solves.`];
  const { dropped, changed } = switched;
  if (dropped.length) {
    const where = (id: string | undefined) =>
      id === undefined ? 'world defaults' : (name.get(id) ?? id);
    const listed = dropped.slice(0, NAMED).map((d) => `${d.name} (${where(d.factoryId)})`);
    const more = dropped.length - listed.length;
    out.push(
      `Dropped ${dropped.length === 1 ? 'a setting' : `${dropped.length} settings`} naming recipes it lacks: ` +
        `${listed.join(', ')}${more ? `, and ${more} more` : ''}.`,
    );
  }
  if (changed.length) {
    const names = changed.map((c) => name.get(c.factoryId) ?? c.factoryId);
    out.push(
      `Manual ${names.length === 1 ? 'factory' : 'factories'} ${names.join(', ')} kept ${names.length === 1 ? 'its' : 'their'} machine counts, but some of ${names.length === 1 ? 'its' : 'their'} recipes changed.`,
    );
  }
  return out.join(' ');
}
