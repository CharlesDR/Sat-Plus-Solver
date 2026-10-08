/**
 * Where the user is (A42): the world, or a chain of factories from the
 * outermost in. A sub-factory (A49) opens below its parents, so Esc and the
 * breadcrumb step back one level at a time: grandchild, child, parent, world.
 */
export interface View {
  readonly path: readonly string[];
}

export const WORLD_VIEW: View = { path: [] };

/**
 * A factory opened from the world, the palette, the breadcrumb or its
 * parent's flowchart: its parents first, outermost in (`parentOf` gives each
 * factory's parent). A parent cycle stops the chain.
 */
export function factoryView(
  id: string,
  parentOf: (id: string) => string | undefined = () => undefined,
): View {
  const path = [id];
  for (let p = parentOf(id); p !== undefined && !path.includes(p); p = parentOf(p)) path.unshift(p);
  return { path };
}

/** One level out: the factory's parent, or the world. */
export function backOut(view: View): View {
  return view.path.length ? { path: view.path.slice(0, -1) } : view;
}

/** The factory shown, if it still exists; otherwise the world is shown. */
export function focusOf(view: View, exists: (id: string) => boolean): string | undefined {
  const id = view.path.at(-1);
  return id !== undefined && exists(id) ? id : undefined;
}

/** A world's parent lookup for `factoryView`. */
export function parentLookup(world: {
  factories: readonly { id: string; parentId?: string }[];
}): (id: string) => string | undefined {
  const m = new Map(world.factories.map((f) => [f.id, f.parentId]));
  return (id) => {
    const p = m.get(id);
    return p !== undefined && m.has(p) ? p : undefined;
  };
}
