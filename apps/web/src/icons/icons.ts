/**
 * Item and machine icons (A38), served from `public/icons` and listed in
 * `manifest.json` by `tooling/import-icons.py`. Anything without an icon gets
 * `undefined`, and the caller draws a placeholder.
 */
import type { FlowNode } from '@sps/graph';
import type { CatalogRecipe } from '../solver/protocol';
import manifest from './manifest.json';

const items = new Set<string>(manifest.items);
const machines = new Set<string>(manifest.machines);
const base = `${import.meta.env.BASE_URL}icons`;

export function itemIcon(id: string | undefined): string | undefined {
  return id !== undefined && items.has(id) ? `${base}/items/${id}.webp` : undefined;
}

/** Machine ids are the slugs of their names (the data build's rule). */
export const machineSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function machineIcon(name: string | undefined): string | undefined {
  const id = name === undefined ? undefined : machineSlug(name);
  return id !== undefined && machines.has(id) ? `${base}/machines/${id}.webp` : undefined;
}

/**
 * A flowchart node's icon: its item, or for a recipe group its main product
 * (the recipe's first output), falling back to its machine (a generator makes
 * only power).
 */
export function flowNodeIcon(
  node: FlowNode,
  recipes: ReadonlyMap<string, CatalogRecipe>,
): string | undefined {
  if (node.item !== undefined) return itemIcon(node.item);
  const recipe = node.recipe !== undefined ? recipes.get(node.recipe) : undefined;
  return itemIcon(recipe?.outputs[0]) ?? machineIcon(node.machine);
}
