/** Messages between the main thread and the solver worker. */
import type { NodePurity } from '@sps/data';
import type { FactoryGraph } from '@sps/graph';
import type { PlanSummary } from '@sps/solver';
import type { World } from '@sps/world';

/** An item the target picker offers. */
export interface CatalogItem {
  id: string;
  name: string;
}

/** A recipe the recipe toggles list. */
export interface CatalogRecipe {
  id: string;
  name: string;
  /** Machine display name. */
  machine: string;
  alternate: boolean;
  /** Dataset tier, `"<major>-<minor>"`. */
  tier: string;
  /** Output item names, for search. */
  products: string[];
}

/** A node class the node-budget editor lists. */
export interface CatalogNode {
  id: string;
  /** "Resource (purity)". */
  label: string;
  purity: NodePurity;
  /** Map-wide count from nodes.csv. */
  count: number;
}

/** What the factory controls pick from, sent once when the worker is ready. */
export interface Catalog {
  /** Items a target can name. */
  targets: CatalogItem[];
  /** Items an unassigned import can name. */
  items: CatalogItem[];
  /** Sorted by name, then id. */
  recipes: CatalogRecipe[];
  /** Sorted by label, then id. */
  nodes: CatalogNode[];
  /** Distinct recipe tiers above `0-0`, in tier order. */
  tiers: string[];
}

export type ToWorker = { type: 'solve'; id: number; world: World; factoryId: string };

export type FromWorker =
  | { type: 'ready'; catalog: Catalog; dataHash: string }
  | { type: 'init-error'; message: string }
  | { type: 'solved'; id: number; plan: PlanSummary; graph: FactoryGraph; ms: number }
  | { type: 'failed'; id: number; message: string };
