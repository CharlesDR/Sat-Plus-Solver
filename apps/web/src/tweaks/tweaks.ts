/**
 * Plan tweaks as data (A35): what the node actions offer for a flowchart
 * node, the swap candidates for its recipe, and how a tweak or a swap
 * preview reads. Pure, so it is tested without React.
 */
import type { FlowNode } from '@sps/graph';
import { recipeExclusion } from '@sps/solver';
import { recipeFilter, type Factory, type Tweak, type World } from '@sps/world';
import type { CatalogRecipe, SwapPreview } from '../solver/protocol';

export interface Names {
  item(id: string): string;
  recipe(id: string): string;
}

/** What the node actions work on: a recipe group and its main product. */
export interface TweakTarget {
  recipe: string;
  name: string;
  /** The recipe's first output: what a swap must still make, and what "import instead" buys. */
  product: string;
}

/** The selected flowchart node as a tweak target; only recipe and resource nodes are one. */
export function tweakTarget(
  node: FlowNode | undefined,
  recipes: ReadonlyMap<string, CatalogRecipe>,
): TweakTarget | undefined {
  if (!node?.recipe || (node.kind !== 'recipe' && node.kind !== 'resource')) return undefined;
  const product = recipes.get(node.recipe)?.outputs[0];
  if (product === undefined) return undefined;
  return { recipe: node.recipe, name: node.label, product };
}

export interface SwapCandidate {
  recipe: CatalogRecipe;
  /** Set when the swap can't apply: the max-tier filter beats a tweak (A23). */
  blocked?: 'tier';
}

/**
 * Recipes that make the target's product, other than the target itself:
 * standard ones first, then alternates, each by name. A recipe above the
 * factory's max tier is listed as blocked.
 */
export function swapCandidates(
  world: World,
  factory: Factory,
  target: TweakTarget,
  recipes: readonly CatalogRecipe[],
): SwapCandidate[] {
  const filter = recipeFilter(world, factory);
  const out: SwapCandidate[] = [];
  for (const r of recipes) {
    if (r.id === target.recipe || !r.outputs.includes(target.product)) continue;
    out.push(
      recipeExclusion(r, filter) === 'tier' ? { recipe: r, blocked: 'tier' } : { recipe: r },
    );
  }
  const rank = (c: SwapCandidate) => (c.blocked ? 2 : c.recipe.alternate ? 1 : 0);
  // `recipes` is sorted by name, then id, and the sort is stable.
  return out.sort((a, b) => rank(a) - rank(b));
}

/** A tweak in a sentence, for the tweak list. */
export function tweakLabel(t: Tweak, names: Names): string {
  switch (t.kind) {
    case 'ban':
      return `Don’t use ${names.recipe(t.recipe)}`;
    case 'swap':
      return `${names.recipe(t.from)} → ${names.recipe(t.to)}`;
    case 'import':
      return `Import ${names.item(t.item)}`;
  }
}

/** The factory's current numbers, as a swap preview is measured against. */
export type Baseline = Omit<SwapPreview, 'recipe'>;

const EPS = 1e-6;
const signed = (v: number, digits: number) =>
  `${v > 0 ? '+' : '−'}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: digits })}`;

/**
 * A swap preview against the current plan, in a few words: whole machines,
 * machine draw, and the raw resources that change most (at most three).
 * "Same as now" when nothing moves.
 */
export function previewDelta(base: Baseline, p: SwapPreview, names: Names): string {
  if (p.status === 'infeasible') return 'Can’t meet the targets';
  const parts: string[] = [];
  const machines = p.machines - base.machines;
  if (Math.abs(machines) > EPS)
    parts.push(`${signed(machines, 0)} machine${Math.abs(machines) === 1 ? '' : 's'}`);
  const mw = p.consumptionMW - base.consumptionMW;
  if (Math.abs(mw) > 0.05) parts.push(`${signed(mw, 1)} MW`);
  const rates = new Map<string, number>();
  for (const e of base.extraction) rates.set(e.item, -e.rate);
  for (const e of p.extraction) rates.set(e.item, (rates.get(e.item) ?? 0) + e.rate);
  const moved = [...rates]
    .filter(([, d]) => Math.abs(d) > 0.05)
    .sort(([a, x], [b, y]) => Math.abs(y) - Math.abs(x) || (a < b ? -1 : 1))
    .slice(0, 3);
  for (const [item, d] of moved) parts.push(`${signed(d, 1)} ${names.item(item)}/min`);
  if (p.status === 'short') parts.push('an import runs short');
  return parts.length ? parts.join(', ') : 'Same as now';
}
