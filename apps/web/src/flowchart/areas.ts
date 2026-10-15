/**
 * Flowchart areas in the app (A64): the data build's areas from the
 * catalog, and the factory's own names for them.
 */
import type { AreaCatalog, AreaSettings, FactoryGraph } from '@sps/graph';
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

/** Auto-collapse (A89): a plan with more recipe boxes than this opens with big areas collapsed. */
export const AUTO_COLLAPSE_NODES = 40;
/** Auto-collapse (A89): areas with at least this many recipe boxes collapse. */
export const AUTO_COLLAPSE_AREA = 10;

const isBox = (kind: string) => kind === 'recipe' || kind === 'resource' || kind === 'sub-factory';

/**
 * What identifies a plan for auto-collapse (A89): how it is grouped and its
 * nodes, not their rates, so a change of rates alone keeps the user's choice.
 */
export function planKey(graph: FactoryGraph, settings: AreaSettings | undefined): string {
  const how = settings?.off ? 'off' : (settings?.by ?? 'pinch');
  return [how, ...graph.nodes.map((n) => n.id).sort()].join('\n');
}

/**
 * The areas to collapse when a new plan arrives (A89): with more than
 * `AUTO_COLLAPSE_NODES` recipe boxes, every area of `AUTO_COLLAPSE_AREA` or
 * more, except the one holding the targets. `grouped` is the plan grouped
 * with nothing collapsed.
 */
export function autoCollapsed(grouped: FactoryGraph): Set<string> {
  const out = new Set<string>();
  if (!grouped.areas) return out;
  const boxes = grouped.nodes.filter((n) => isBox(n.kind));
  if (boxes.length <= AUTO_COLLAPSE_NODES) return out;
  const targets = new Set(grouped.nodes.filter((n) => n.kind === 'target').map((n) => n.area));
  for (const a of grouped.areas) {
    if (targets.has(a.id)) continue;
    if (boxes.filter((n) => n.area === a.id).length >= AUTO_COLLAPSE_AREA) out.add(a.id);
  }
  return out;
}
