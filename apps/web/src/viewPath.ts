/**
 * Where the user is (A42): the world, or a chain of factories from the
 * outermost in. Today a factory view is always one deep; nested factories
 * (WF-1) will open a child below its parent, and Esc and the breadcrumb step
 * back one level at a time.
 */
export interface View {
  readonly path: readonly string[];
}

export const WORLD_VIEW: View = { path: [] };

/** A factory opened from the world, the palette or the factory switcher. */
export const factoryView = (id: string): View => ({ path: [id] });

/** One level out: the factory's parent, or the world. */
export function backOut(view: View): View {
  return view.path.length ? { path: view.path.slice(0, -1) } : view;
}

/** The factory shown, if it still exists; otherwise the world is shown. */
export function focusOf(view: View, exists: (id: string) => boolean): string | undefined {
  const id = view.path.at(-1);
  return id !== undefined && exists(id) ? id : undefined;
}
