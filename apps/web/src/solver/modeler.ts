/**
 * A factory's flowchart as a Modeler sheet (M14, A58): its recipe groups at
 * their laid-out spots, its imports and outputs as the Outpost's ports, and
 * one belt per flowchart edge.
 */
import type { FactoryGraph, FactoryLayout } from '@sps/graph';
import type { ModelerSheet, SheetNode } from '@sps/world';

/**
 * `nested`: the world is exported, so a sub-factory is its own Outpost and
 * the links wire it; its box is left out. Otherwise it is just an input or
 * an output of this one.
 */
export function modelerSheet(
  factory: string,
  graph: FactoryGraph,
  layout: Pick<FactoryLayout, 'nodes'>,
  nested: boolean,
  /** The plan's counts by recipe, as manual mode keeps them; the graph's are rounded for heaters. */
  counts: ReadonlyMap<string, number> = new Map(),
): ModelerSheet {
  const at = new Map(layout.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const nodes: SheetNode[] = [];
  const kept = new Set<string>();
  for (const n of graph.nodes) {
    const { x, y } = at.get(n.id) ?? { x: 0, y: 0 };
    if ((n.kind === 'recipe' || n.kind === 'resource') && n.recipe && n.machines !== undefined) {
      // Heaters (A17): the plan's count is boiler throughput, as manual mode keeps it.
      nodes.push({
        key: n.id,
        kind: 'recipe',
        recipe: n.recipe,
        machines: counts.get(n.recipe) ?? n.machines * (n.boilerLoad ?? 1),
        x,
        y,
      });
    } else if (n.kind === 'import' || n.kind === 'missing') {
      nodes.push({ key: n.id, kind: 'in', item: n.item!, x, y });
    } else if (n.kind === 'target' || n.kind === 'byproduct') {
      // A byproduct leaves too, so Modeler doesn't expect its takers to use all of it.
      nodes.push({ key: n.id, kind: 'out', item: n.item!, x, y });
    } else if (n.kind === 'sub-factory' && !nested) {
      // Not nested: what it sends is an input, what it takes an output.
      nodes.push(
        { key: `${n.id}:in`, kind: 'in', item: '', x, y },
        { key: `${n.id}:out`, kind: 'out', item: '', x, y },
      );
    } else continue;
    kept.add(n.id);
  }
  const belts: ModelerSheet['belts'] = [];
  for (const e of graph.edges) {
    const sub = (id: string, side: 'in' | 'out') =>
      id.startsWith('sub:') && !nested ? `${id}:${side}` : id;
    const from = sub(e.source, 'in');
    const to = sub(e.target, 'out');
    if (!kept.has(e.source) || !kept.has(e.target)) continue;
    belts.push({ from, to, item: e.item });
  }
  return { factory, nodes, belts };
}
