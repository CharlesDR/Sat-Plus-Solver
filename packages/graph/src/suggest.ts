/**
 * Suggested imports (A91): parts that, imported, would take a good share of
 * a plan away, like Plastic and Rubber made in one place from Crude Oil and
 * Water and shipped to the factories that need them. Read from the plan's
 * own graph, so it costs no solve; the app re-solves the best few for exact
 * numbers.
 */
import type { FactoryGraph, FlowNode } from './factory';
import { isBox } from './pinch';

export interface ImportSuggestion {
  item: string;
  name: string;
  /** Recipe boxes (and nested factories) used only to make it. */
  boxes: number;
  /** Raw resources only those boxes extract, sorted. */
  resources: string[];
  /** Imports only those boxes take, sorted. */
  imports: string[];
  /** How it ranks: boxes, plus raw resources weighed 2 (solids) or 4 (fluids). */
  score: number;
}

/** A suggestion takes at least this share of the plan's boxes, or `SUGGEST_MIN_RESOURCES` resources. */
export const SUGGEST_MIN_SHARE = 0.2;
export const SUGGEST_MIN_RESOURCES = 2;

/**
 * Each intermediate part's exclusive upstream: its makers, when they make
 * nothing else the plan uses, and every box whose output goes only into that
 * set. Parts whose upstream is big enough (`SUGGEST_MIN_SHARE` of the boxes,
 * or `SUGGEST_MIN_RESOURCES` raw resources) are suggested, best first; a part
 * whose upstream lies inside a better suggestion's is left out. Targets, raw
 * resources and parts already imported are never suggested.
 */
export function importSuggestions(
  graph: FactoryGraph,
  fluids: ReadonlySet<string> = new Set(),
): ImportSuggestion[] {
  const node = new Map(graph.nodes.map((n) => [n.id, n]));
  const boxes = graph.nodes.filter(isBox);
  if (!boxes.length) return [];
  const out = new Map<string, typeof graph.edges>();
  for (const e of graph.edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);
  const dumped = (id: string) => node.get(id)?.kind === 'byproduct';
  const raw = (n: FlowNode) => n.kind === 'resource';
  const rawItems = new Set(boxes.filter(raw).flatMap((n) => n.outputs.map((o) => o.item)));
  const imported = new Set(graph.nodes.filter((n) => n.kind === 'import').map((n) => n.item));
  const targets = new Set(graph.nodes.filter((n) => n.kind === 'target').map((n) => n.item));
  // Parts one box makes and another box uses.
  const parts = new Map<string, string>();
  for (const e of graph.edges)
    if (isBox(node.get(e.source)!) && isBox(node.get(e.target)!)) parts.set(e.item, e.itemName);

  const found: (ImportSuggestion & { set: Set<string> })[] = [];
  for (const [item, name] of [...parts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (rawItems.has(item) || imported.has(item) || targets.has(item)) continue;
    const set = new Set<string>();
    // Makers whose every line carries this part or goes to a byproduct dump.
    for (const b of boxes)
      if ((out.get(b.id) ?? []).some((e) => e.item === item))
        if ((out.get(b.id) ?? []).every((e) => e.item === item || dumped(e.target))) set.add(b.id);
    if (!set.size) continue;
    for (let grew = true; grew;) {
      grew = false;
      for (const b of boxes) {
        if (set.has(b.id)) continue;
        const lines = out.get(b.id) ?? [];
        if (
          lines.some((e) => set.has(e.target)) &&
          lines.every((e) => set.has(e.target) || dumped(e.target))
        ) {
          set.add(b.id);
          grew = true;
        }
      }
    }
    // Raw resources and imports only this upstream takes.
    const only = (pairs: [item: string, mine: boolean][]) => {
      const theirs = new Set(pairs.filter(([, m]) => !m).map(([i]) => i));
      return [...new Set(pairs.filter(([i, m]) => m && !theirs.has(i)).map(([i]) => i))].sort();
    };
    const resources = only(
      boxes
        .filter(raw)
        .flatMap((n) => n.outputs.map((o): [string, boolean] => [o.item, set.has(n.id)])),
    );
    const imports = only(
      graph.edges
        .filter((e) => node.get(e.source)!.kind === 'import')
        .map((e): [string, boolean] => [e.item, set.has(e.target)]),
    );
    const big =
      set.size >= SUGGEST_MIN_SHARE * boxes.length || resources.length >= SUGGEST_MIN_RESOURCES;
    if (!big) continue;
    const score = set.size + resources.reduce((s, r) => s + (fluids.has(r) ? 4 : 2), 0);
    found.push({ item, name, boxes: set.size, resources, imports, score, set });
  }
  found.sort((a, b) => b.score - a.score || (a.item < b.item ? -1 : 1));
  const kept: typeof found = [];
  for (const f of found)
    if (!kept.some((k) => [...f.set].every((id) => k.set.has(id)))) kept.push(f);
  return kept.map(({ set: _, ...s }) => s);
}
