/**
 * Flowchart areas in the app (A57): the data build's areas from the
 * catalog, and the factory's own names for them.
 */
import type { AreaCatalog, AreaSettings } from '@sps/graph';
import type { Catalog } from '../solver/protocol';

/** The catalog's areas as the graph package groups by them. */
export function areaCatalog(catalog: Pick<Catalog, 'areas' | 'itemAreas'>): AreaCatalog {
  const at = new Map(Object.entries(catalog.itemAreas));
  return { areas: catalog.areas, itemArea: (item) => at.get(item) };
}

/** Every area a box can move to, by the factory's names, in production order. */
export function areaChoices(
  catalog: Pick<Catalog, 'areas'>,
  settings: AreaSettings | undefined,
): { id: string; name: string }[] {
  return catalog.areas.map((a) => ({
    id: a.id,
    name: settings?.names?.[a.id]?.trim() || a.name,
  }));
}
