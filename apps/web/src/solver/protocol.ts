/** Messages between the main thread and the solver worker. */
import type { Area, BeltCapacity, NodePurity } from '@sps/data';
import type { FactoryGraph } from '@sps/graph';
import type { Diagnostic, PlanSummary, SummaryFlow } from '@sps/solver';
import type { FactoryResult, ModelerReportLine, World, WorldResult } from '@sps/world';

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
  /** Output item ids (no MW), for the swap list (A35). */
  outputs: string[];
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

/** A raw resource the resource-limits editor lists (A33). */
export interface CatalogResource {
  id: string;
  name: string;
  fluid: boolean;
  /** Node-limited; `false` for Water and the like, which only turn on and off. */
  limited: boolean;
  /**
   * Node-limited only: its node classes, with the map count and what one node
   * extracts on its best route. The map maximum is Σ pool × rate.
   */
  nodes?: { id: string; count: number; rate: number }[];
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
  /** Raw resources, sorted by name, then id. */
  resources: CatalogResource[];
  /** Distinct recipe tiers above `0-0`, in tier order. */
  tiers: string[];
  /** Fluid item ids (a link carrying one defaults to pipes), sorted. */
  fluids: string[];
  /** Belt capacity per tier, items/min, from the dataset. */
  belts: BeltCapacity[];
  /** Pipe capacity per tier, m³/min (A10). */
  pipes: BeltCapacity[];
  /** Flowchart areas in production order (A64). */
  areas: Area[];
  /** Each item's area id (A64). */
  itemAreas: Record<string, string>;
}

/** A factory's world result without its full solve result, which stays in the worker. */
export interface FactorySummary extends Omit<FactoryResult, 'result'> {
  /** The factory's own solve diagnostics, structured so the UI can offer fixes. */
  diagnostics: Diagnostic[];
}

/** The world result the UI shows (PLAN M8). */
export interface WorldSummary extends Omit<WorldResult, 'factories'> {
  factories: FactorySummary[];
}

/** The plan of the factory open in the factory view, as solved in the world. */
export interface FocusPlan {
  factoryId: string;
  plan: PlanSummary;
  graph: FactoryGraph;
  /** Manual mode (A36): inputs the plan needs beyond its imports (not in `plan.imports`). */
  manual?: { missing: SummaryFlow[] };
}

/**
 * World edits that need the solver: "size power plant" (§4.5), and the swap
 * previews of a plan tweak (A35): the factory as it would solve with
 * `from` swapped for each candidate.
 */
export type WorldAction =
  | { kind: 'size-power'; factoryId: string }
  | { kind: 'preview-swaps'; factoryId: string; from: string; candidates: string[] }
  /** Modeler import (M14, A57): `text` is the `.sfmd` file; `at` the ISO time of the build marks. */
  | { kind: 'import-modeler'; text: string; at: string }
  /** Modeler export (M14, A58): one factory, or the whole world when `factoryId` is missing. */
  | { kind: 'export-modeler'; factoryId?: string };

/** What a Modeler import made, and what it could not map. */
export interface ModelerImported {
  factories: string[];
  report: ModelerReportLine[];
  /** Machine counts sized from the save's flows (A56). */
  inferred: number;
}

/** One swap candidate's effect on its factory (A35). */
export interface SwapPreview {
  recipe: string;
  status: FactoryResult['status'];
  /** Whole machines to build. */
  machines: number;
  /** Machine draw, MW. */
  consumptionMW: number;
  /** Raw resources extracted, per minute, sorted by item. */
  extraction: { item: string; rate: number }[];
}

/** What one world solve asks for. */
export interface WorldSolveRequest {
  world: World;
  /** Factory whose plan and flowchart to return too. */
  focus?: string | undefined;
  /** Runs before the solve; its edited world comes back in `edited`. */
  action?: WorldAction | undefined;
}

/** A solved world: the world summary, the focused plan, and the edited world of an action. */
export interface WorldSolved {
  world: WorldSummary;
  focus?: FocusPlan;
  edited?: World;
  /** `preview-swaps`: one per candidate, in its order. */
  previews?: SwapPreview[];
  /** `import-modeler`: what it made (the world is in `edited`). */
  imported?: ModelerImported;
  /** `export-modeler`: the `.sfmd` file's text. */
  sfmd?: string;
}

export type ToWorker = { type: 'solve'; id: number } & WorldSolveRequest;

/** How far the running world solve has got (ResolveProgress). */
export interface SolveProgress {
  /** Name of the factory solving now. */
  factory: string;
  step: number;
  factories: number;
  pass: number;
}

export type FromWorker =
  | { type: 'ready'; catalog: Catalog; dataHash: string }
  | { type: 'init-error'; message: string }
  | ({ type: 'solved'; id: number; ms: number } & WorldSolved)
  | { type: 'progress'; id: number; progress: SolveProgress }
  | { type: 'failed'; id: number; message: string };
