/**
 * World editing (PLAN M8): adding and removing factories, groups and links.
 * Pure: each function returns a new `World` and shares the parts it leaves
 * alone, so unchanged factories keep their identity (and their cache keys).
 *
 * New ids are stable slugs, `<prefix>-<n>` with the smallest free `n`, so the
 * same edits always give the same ids (CLAUDE.md: never array indices).
 */
import {
  createFactory,
  type Factory,
  type Group,
  type Link,
  type Tweak,
  type World,
} from './document';

export class WorldEditError extends Error {}

/** The smallest `<prefix>-<n>` (n ≥ 1) not in `taken`. */
export function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

const allIds = (world: World) => [
  ...world.factories.map((f) => f.id),
  ...world.groups.map((g) => g.id),
  ...world.links.map((l) => l.id),
];

function need<T extends { id: string }>(xs: readonly T[], id: string, what: string): T {
  const x = xs.find((v) => v.id === id);
  if (!x) throw new WorldEditError(`Unknown ${what} "${id}".`);
  return x;
}

const cleanName = (name: string, fallback: string) => name.trim() || fallback;

/**
 * Adds an empty factory (inheriting every default), optionally inside a group
 * or inside another factory (A49). A sub-factory ignores the group.
 */
export function addFactory(
  world: World,
  name: string,
  groupId?: string,
  parentId?: string,
): { world: World; id: string } {
  if (groupId !== undefined) need(world.groups, groupId, 'group');
  if (parentId !== undefined) need(world.factories, parentId, 'factory');
  const id = nextId('factory', allIds(world));
  const f = createFactory(id, cleanName(name, `Factory ${world.factories.length + 1}`));
  if (parentId !== undefined) f.parentId = parentId;
  else if (groupId !== undefined) f.groupId = groupId;
  return { world: { ...world, factories: [...world.factories, f] }, id };
}

/**
 * Removes a factory and every link to or from it. Its sub-factories move up
 * to its parent, wired to it (A50), or to the top level in its group.
 */
export function removeFactory(world: World, id: string): World {
  const gone = need(world.factories, id, 'factory');
  let out: World = {
    ...world,
    factories: world.factories
      .filter((f) => f.id !== id)
      .map((f) => {
        if (f.parentId !== id) return f;
        const next: Factory = { ...f };
        if (gone.parentId !== undefined) next.parentId = gone.parentId;
        else {
          delete next.parentId;
          if (gone.groupId !== undefined) next.groupId = gone.groupId;
        }
        return next;
      }),
    links: world.links.filter((l) => l.from !== id && l.to !== id),
  };
  if (gone.parentId !== undefined)
    for (const f of out.factories) if (f.parentId === gone.parentId) out = wireChild(out, f.id);
  return out;
}

export function renameFactory(world: World, id: string, name: string): World {
  const f = need(world.factories, id, 'factory');
  return editFactory(world, id, { ...f, name: cleanName(name, f.name) });
}

/** Moves a factory into a group, or out of every group with `undefined`. */
export function setFactoryGroup(world: World, id: string, groupId: string | undefined): World {
  const f = need(world.factories, id, 'factory');
  if (groupId !== undefined) need(world.groups, groupId, 'group');
  const next: Factory = { ...f };
  if (groupId === undefined) delete next.groupId;
  else next.groupId = groupId;
  return editFactory(world, id, next);
}

function editFactory(world: World, id: string, next: Factory): World {
  return { ...world, factories: world.factories.map((f) => (f.id === id ? next : f)) };
}

// Nested factories (A45, A49, A50).

/** The factory's parents, nearest first (stops at a cycle or an unknown parent). */
export function factoryAncestors(world: World, id: string): string[] {
  const parent = new Map(world.factories.map((f) => [f.id, f.parentId]));
  const out: string[] = [];
  for (let at = parent.get(id); at !== undefined && parent.has(at) && !out.includes(at);) {
    out.push(at);
    at = parent.get(at);
  }
  return out;
}

/** Every factory below `id`, sorted by id. */
export function factoryDescendants(world: World, id: string): string[] {
  const out = new Set<string>();
  const walk = (p: string) => {
    for (const f of world.factories)
      if (f.parentId === p && !out.has(f.id) && f.id !== id) {
        out.add(f.id);
        walk(f.id);
      }
  };
  walk(id);
  return [...out].sort();
}

/**
 * Puts a factory inside another, or back at the top level with `undefined`
 * (A49). Refuses a cycle. The links nesting made to the old parent go; the
 * factory's targets are wired to the new one (A50). A nested factory leaves
 * its group.
 */
export function setFactoryParent(world: World, id: string, parentId: string | undefined): World {
  const f = need(world.factories, id, 'factory');
  if (parentId !== undefined) {
    need(world.factories, parentId, 'factory');
    if (parentId === id || factoryAncestors(world, parentId).includes(id))
      throw new WorldEditError(`Factory "${id}" cannot be nested inside itself.`);
  }
  if (f.parentId === parentId) return world;
  const next: Factory = { ...f };
  if (parentId === undefined) delete next.parentId;
  else {
    next.parentId = parentId;
    delete next.groupId;
  }
  const old = f.parentId;
  const out: World = {
    ...editFactory(world, id, next),
    links: world.links.filter((l) => !(l.nested && l.from === id && l.to === old)),
  };
  return wireChild(out, id);
}

/**
 * Automatic wiring (A50): a pull link from a sub-factory to its parent for
 * each of its target items (or each of `items`) that no link from it to the
 * parent carries yet. Does nothing for a top-level factory.
 */
export function wireChild(world: World, id: string, items?: readonly string[]): World {
  const f = need(world.factories, id, 'factory');
  const parent = f.parentId;
  if (parent === undefined || !world.factories.some((p) => p.id === parent)) return world;
  const wanted = [...new Set(f.request.targets.map((t) => t.item))]
    .filter((item) => !items || items.includes(item))
    .sort();
  let out = world;
  for (const item of wanted) {
    if (out.links.some((l) => l.from === id && l.to === parent && l.item === item)) continue;
    const linkId = nextId('link', allIds(out));
    const link: Link = {
      id: linkId,
      from: id,
      to: parent,
      item,
      mode: { kind: 'pull' },
      nested: true,
    };
    out = { ...out, links: [...out.links, link] };
  }
  return out;
}

/** Draws a factory with sub-factories as one node on the world canvas, or as a frame (A53). */
export function setFactoryCollapsed(world: World, id: string, collapsed: boolean): World {
  const f = need(world.factories, id, 'factory');
  if ((f.collapsed ?? false) === collapsed) return world;
  const next: Factory = { ...f };
  if (collapsed) next.collapsed = true;
  else delete next.collapsed;
  return editFactory(world, id, next);
}

/** Adds an expanded group, optionally nested in another. */
export function addGroup(
  world: World,
  name: string,
  parentId?: string,
): { world: World; id: string } {
  if (parentId !== undefined) need(world.groups, parentId, 'group');
  const id = nextId('group', allIds(world));
  const g: Group = {
    id,
    name: cleanName(name, `Group ${world.groups.length + 1}`),
    collapsed: false,
  };
  if (parentId !== undefined) g.parentId = parentId;
  return { world: { ...world, groups: [...world.groups, g] }, id };
}

/** Removes a group; its factories and subgroups move up to its parent. */
export function removeGroup(world: World, id: string): World {
  const g = need(world.groups, id, 'group');
  const up = <T extends { groupId?: string } | { parentId?: string }>(
    x: T,
    key: 'groupId' | 'parentId',
  ): T => {
    if ((x as Record<string, unknown>)[key] !== id) return x;
    const next = { ...x } as Record<string, unknown>;
    if (g.parentId === undefined) delete next[key];
    else next[key] = g.parentId;
    return next as T;
  };
  return {
    ...world,
    groups: world.groups.filter((x) => x.id !== id).map((x) => up(x, 'parentId')),
    factories: world.factories.map((f) => up(f, 'groupId')),
  };
}

export function renameGroup(world: World, id: string, name: string): World {
  const g = need(world.groups, id, 'group');
  return editGroup(world, id, { ...g, name: cleanName(name, g.name) });
}

export function setGroupCollapsed(world: World, id: string, collapsed: boolean): World {
  const g = need(world.groups, id, 'group');
  return g.collapsed === collapsed ? world : editGroup(world, id, { ...g, collapsed });
}

/** The group's ancestors, nearest first (stops at a cycle). */
export function groupAncestors(world: World, id: string): string[] {
  const parent = new Map(world.groups.map((g) => [g.id, g.parentId]));
  const out: string[] = [];
  for (let at = parent.get(id); at !== undefined && !out.includes(at); at = parent.get(at))
    out.push(at);
  return out;
}

/** Nests a group in another, or moves it to the top with `undefined`. Refuses a cycle. */
export function setGroupParent(world: World, id: string, parentId: string | undefined): World {
  const g = need(world.groups, id, 'group');
  if (parentId !== undefined) {
    need(world.groups, parentId, 'group');
    if (parentId === id || groupAncestors(world, parentId).includes(id))
      throw new WorldEditError(`Group "${id}" cannot be nested inside itself.`);
  }
  const next: Group = { ...g };
  if (parentId === undefined) delete next.parentId;
  else next.parentId = parentId;
  return editGroup(world, id, next);
}

function editGroup(world: World, id: string, next: Group): World {
  return { ...world, groups: world.groups.map((g) => (g.id === id ? next : g)) };
}

/** What a link carries and how; `from`/`to`/`item` must name existing things. */
export type LinkSpec = Omit<Link, 'id'>;

function checkLink(world: World, spec: LinkSpec): void {
  need(world.factories, spec.from, 'factory');
  need(world.factories, spec.to, 'factory');
  if (spec.from === spec.to) throw new WorldEditError('A link needs two different factories.');
  if (!spec.item) throw new WorldEditError('A link needs an item.');
  if (spec.mode.kind === 'fixed' && !(Number.isFinite(spec.mode.rate) && spec.mode.rate >= 0))
    throw new WorldEditError(`A fixed link needs a rate of 0 or more (got ${spec.mode.rate}).`);
}

const copyLink = (id: string, spec: LinkSpec): Link => ({
  id,
  from: spec.from,
  to: spec.to,
  item: spec.item,
  mode: spec.mode.kind === 'fixed' ? { kind: 'fixed', rate: spec.mode.rate } : { kind: 'pull' },
  ...(spec.transport ? { transport: { ...spec.transport } } : {}),
});

export function addLink(world: World, spec: LinkSpec): { world: World; id: string } {
  checkLink(world, spec);
  const id = nextId('link', allIds(world));
  return { world: { ...world, links: [...world.links, copyLink(id, spec)] }, id };
}

export function updateLink(world: World, id: string, spec: LinkSpec): World {
  need(world.links, id, 'link');
  checkLink(world, spec);
  return { ...world, links: world.links.map((l) => (l.id === id ? copyLink(id, spec) : l)) };
}

export function removeLink(world: World, id: string): World {
  need(world.links, id, 'link');
  return { ...world, links: world.links.filter((l) => l.id !== id) };
}

// Plan tweaks (A35). The tweak list is the undo history, so undo drops the
// last tweak and "revert all" empties the list; nothing else is kept.

const sameTweak = (a: Tweak, b: Tweak) => JSON.stringify(a) === JSON.stringify(b);

/** Adds a tweak to a factory. Repeating its last tweak changes nothing. */
export function addTweak(world: World, factoryId: string, tweak: Tweak): World {
  const f = need(world.factories, factoryId, 'factory');
  if (tweak.kind === 'swap' && tweak.from === tweak.to)
    throw new WorldEditError('A recipe cannot be swapped for itself.');
  const last = f.tweaks[f.tweaks.length - 1];
  if (last && sameTweak(last, tweak)) return world;
  return editFactory(world, factoryId, { ...f, tweaks: [...f.tweaks, { ...tweak }] });
}

/** Undoes the factory's most recent tweak; no tweaks changes nothing. */
export function undoTweak(world: World, factoryId: string): World {
  const f = need(world.factories, factoryId, 'factory');
  if (!f.tweaks.length) return world;
  return editFactory(world, factoryId, { ...f, tweaks: f.tweaks.slice(0, -1) });
}

/** Removes one tweak, by its position in the list. */
export function removeTweak(world: World, factoryId: string, index: number): World {
  const f = need(world.factories, factoryId, 'factory');
  if (!Number.isInteger(index) || index < 0 || index >= f.tweaks.length)
    throw new WorldEditError(`No tweak at ${index}.`);
  return editFactory(world, factoryId, { ...f, tweaks: f.tweaks.filter((_, k) => k !== index) });
}

/** Reverts every tweak: the factory goes back to the pure solver plan. */
export function revertTweaks(world: World, factoryId: string): World {
  const f = need(world.factories, factoryId, 'factory');
  if (!f.tweaks.length) return world;
  return editFactory(world, factoryId, { ...f, tweaks: [] });
}
