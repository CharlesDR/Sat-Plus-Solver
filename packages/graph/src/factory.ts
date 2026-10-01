/**
 * Factory flowchart (docs/ARCHITECTURE.md §5, PLAN M7): a solved plan as a
 * graph of recipe, resource-node, import, target/export and byproduct nodes,
 * joined by one edge per item and producer → consumer pair.
 *
 * Rates come from the plan's own per-recipe flows (`RecipeUsage.inputs` and
 * `outputs`), never `rate × machines`: heater fuel and exhaust run per whole
 * heater and the boiler pair at the boiler load (A17), and only the solver
 * knows which is which.
 *
 * The LP gives totals per item, not who feeds whom, so `allocate` decides
 * (A24). Every node conserves its rates up to the plan's own balance
 * tolerance.
 */
import type { ItemRate, RecipeUsage, SolveResult } from '@sps/solver';

export type FlowNodeKind = 'recipe' | 'resource' | 'import' | 'target' | 'byproduct';

export interface FlowNode {
  /** `recipe:<id>`, `import:<item>`, `target:<item>` or `byproduct:<item>`. */
  id: string;
  kind: FlowNodeKind;
  /** Recipe name, or the item name for import/target/byproduct nodes. */
  label: string;
  /** Recipe and resource nodes: the recipe id. */
  recipe?: string;
  /** Machine display name (recipe and resource nodes). */
  machine?: string;
  /** Fractional machine count; whole heaters for heaters (A17). */
  machines?: number;
  machinesCeil?: number;
  /** Heaters only: boiler load 0–1. */
  boilerLoad?: number;
  /** Node class drawn on (resource nodes). */
  node?: string;
  /** Import/target/byproduct nodes: the item and its rate. */
  item?: string;
  rate?: number;
  /** What flows in and out per minute, merged per item and sorted by item. */
  inputs: ItemRate[];
  outputs: ItemRate[];
}

export interface FlowEdge {
  /** `<source>→<target>:<item>`. */
  id: string;
  source: string;
  target: string;
  item: string;
  itemName: string;
  /** Per minute (MW for power). */
  rate: number;
}

export interface FactoryGraph {
  /** Sorted by kind (imports, resources, recipes, targets, byproducts), then id. */
  nodes: FlowNode[];
  /** Sorted by id. */
  edges: FlowEdge[];
}

/** Display names; ids are shown where a name is missing. */
export interface GraphLabels {
  item?: (id: string) => string | undefined;
  machine?: (id: string) => string | undefined;
}

/** The parts of a solve result the flowchart reads. */
export type FlowchartInput = Pick<
  SolveResult,
  'status' | 'recipes' | 'items' | 'imports' | 'surplus'
>;

const KIND_ORDER: Record<FlowNodeKind, number> = {
  import: 0,
  resource: 1,
  recipe: 2,
  target: 3,
  byproduct: 4,
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Positive rates merged per item, sorted by item. */
function merge(flows: readonly ItemRate[]): ItemRate[] {
  const m = new Map<string, number>();
  for (const f of flows) if (f.rate > 0) m.set(f.item, (m.get(f.item) ?? 0) + f.rate);
  return [...m].sort(([a], [b]) => cmp(a, b)).map(([item, rate]) => ({ item, rate }));
}

export const recipeNodeId = (recipe: string) => `recipe:${recipe}`;
export const importNodeId = (item: string) => `import:${item}`;
export const targetNodeId = (item: string) => `target:${item}`;
export const byproductNodeId = (item: string) => `byproduct:${item}`;

/** Builds the flowchart of a solved plan. A plan that is not `ok` gives an empty graph. */
export function factoryGraph(result: FlowchartInput, labels: GraphLabels = {}): FactoryGraph {
  if (result.status !== 'ok') return { nodes: [], edges: [] };
  const itemName = (id: string) => labels.item?.(id) ?? id;
  const nodes: FlowNode[] = [];

  const recipeNode = (r: RecipeUsage): FlowNode => ({
    id: recipeNodeId(r.id),
    kind: r.node ? 'resource' : 'recipe',
    label: r.name,
    recipe: r.id,
    machine: labels.machine?.(r.machine) ?? r.machine,
    machines: r.machines,
    machinesCeil: r.machinesCeil,
    ...(r.boilerLoad !== undefined ? { boilerLoad: r.boilerLoad } : {}),
    ...(r.node ? { node: r.node } : {}),
    inputs: merge(r.inputs),
    outputs: merge(r.outputs),
  });
  for (const r of result.recipes) nodes.push(recipeNode(r));
  for (const f of merge(result.imports))
    nodes.push(endpoint('import', importNodeId(f.item), f, itemName(f.item)));
  for (const f of merge(result.items.map((i) => ({ item: i.item, rate: i.demand }))))
    nodes.push(endpoint('target', targetNodeId(f.item), f, itemName(f.item)));
  for (const f of merge(result.surplus))
    nodes.push(endpoint('byproduct', byproductNodeId(f.item), f, itemName(f.item)));
  nodes.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || cmp(a.id, b.id));

  // Per item: who supplies it and who takes it, in node order.
  const supply = new Map<string, { node: string; rate: number }[]>();
  const take = new Map<string, { node: string; rate: number }[]>();
  const push = (m: typeof supply, item: string, node: string, rate: number) => {
    const list = m.get(item);
    if (list) list.push({ node, rate });
    else m.set(item, [{ node, rate }]);
  };
  for (const n of nodes) {
    for (const f of n.outputs) push(supply, f.item, n.id, f.rate);
    for (const f of n.inputs) push(take, f.item, n.id, f.rate);
  }

  const edges: FlowEdge[] = [];
  for (const [item, producers] of supply) {
    const consumers = take.get(item);
    if (!consumers) continue;
    for (const { source, target, rate } of allocate(producers, consumers))
      edges.push({
        id: `${source}→${target}:${item}`,
        source,
        target,
        item,
        itemName: itemName(item),
        rate,
      });
  }
  edges.sort((a, b) => cmp(a.id, b.id));
  return { nodes, edges };
}

/**
 * Splits one item's supply over its consumers in node order (A24): each
 * producer fills consumers in turn until its output is used up. Every node
 * conserves its rate, and an item gets at most producers + consumers − 1
 * edges. Consumers are scaled by Σ supply / Σ demand first, so the plan's own
 * balance residual (≤ 1e-6 relative) never leaves a sliver edge.
 */
export function allocate(
  producers: readonly { node: string; rate: number }[],
  consumers: readonly { node: string; rate: number }[],
): { source: string; target: string; rate: number }[] {
  const supply = producers.reduce((s, p) => s + p.rate, 0);
  const demand = consumers.reduce((s, c) => s + c.rate, 0);
  if (!(supply > 0) || !(demand > 0)) return [];
  const eps = SLIVER * supply;
  const out: { source: string; target: string; rate: number }[] = [];
  let i = 0;
  let j = 0;
  let left = producers[0]!.rate;
  let need = (consumers[0]!.rate * supply) / demand;
  while (i < producers.length && j < consumers.length) {
    const rate = Math.min(left, need);
    if (rate > eps) out.push({ source: producers[i]!.node, target: consumers[j]!.node, rate });
    left -= rate;
    need -= rate;
    if (left <= eps && ++i < producers.length) left = producers[i]!.rate;
    if (need <= eps && ++j < consumers.length) need = (consumers[j]!.rate * supply) / demand;
  }
  return out;
}

/** Edges below this share of an item's supply are rounding leftovers. */
const SLIVER = 1e-12;

function endpoint(kind: FlowNodeKind, id: string, f: ItemRate, label: string): FlowNode {
  const flow = [{ item: f.item, rate: f.rate }];
  return {
    id,
    kind,
    label,
    item: f.item,
    rate: f.rate,
    inputs: kind === 'import' ? [] : flow,
    outputs: kind === 'import' ? flow : [],
  };
}
