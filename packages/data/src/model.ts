/**
 * Canonical model consumed by the solver (docs/ARCHITECTURE.md §2.2, §6).
 * Units: items/min, fluids m³/min, power MW (positive = consumption).
 * Every rate in `inputs`/`outputs` is positive and per machine.
 */

export const MODEL_SCHEMA_VERSION = 4;

/** Id of the power pseudo-item output by generator recipes. Its rate unit is MW. */
export const MW_ITEM_ID = 'mw';

export type ItemForm = 'solid' | 'fluid' | 'power' | 'virtual';

export interface Item {
  id: string;
  name: string;
  form: ItemForm;
  sinkPoints: number;
  tier: string;
  /**
   * Solid and fluid items: the flowchart area its recipes are drawn in
   * (A57). Absent in models built before areas.
   */
  area?: string;
}

/** A flowchart area (A57), in production order in `Model.areas`. */
export interface Area {
  id: string;
  name: string;
  /** `targets`: where recipes making a plan's target go; `fallback`: anything else unplaced. */
  rule?: 'raw' | 'targets' | 'fallback';
}

export interface Machine {
  id: string;
  name: string;
  /** Draw at 100% clock (negative = generation). */
  powerMW: number;
}

export interface Flow {
  item: string;
  /** Per machine, per minute (MW for the `mw` item). Always > 0. */
  rate: number;
  /**
   * Heater recipes only (A17): set on the heater side (fuel and heater
   * byproducts), which always runs at 100% per whole machine. Absent on the
   * boiler pair and on every flow of other recipes.
   */
  heater?: true;
}

export type RecipeKind = 'production' | 'generator' | 'extraction';

export type Purity = 'impure' | 'normal' | 'pure';
export type NodePurity = Purity | 'site';

export interface MinerRoute {
  resource: string; // item id of the node resource
  purity: Purity;
  processing: string | null; // primary product item id, or null for plain mining
  fluid: string | null; // fluid item id, or null
}

export interface Recipe {
  id: string;
  name: string;
  machine: string; // machine id
  kind: RecipeKind;
  alternate: boolean;
  tier: string;
  inputs: Flow[];
  outputs: Flow[];
  /** Per machine at this recipe's clock (negative = generation). */
  powerMW: number;
  /** 1 for 100%; extraction on limited nodes runs overclocked. */
  clock: number;
  /** Node class this recipe draws on: one machine uses one node (or one fracking site). */
  node?: string;
  source: 'dataset' | 'generated';
  /** Present on generated Modular Miner routes. */
  route?: MinerRoute;
  /**
   * Extraction recipes: the raw resource drawn per machine, per minute (A33).
   * For a Modular Miner route it is the base extraction before processing,
   * fluid and boosters included; for other extractors, their output.
   */
  extracts?: { item: string; rate: number };
  /**
   * Heater/boiler recipe (A17): flows marked `heater` scale with whole
   * machines; the rest (the boiler pair) scale with boiler throughput.
   */
  heater?: true;
}

export interface ResourceNode {
  id: string;
  resource: string; // item id
  purity: NodePurity;
  /** Map-wide count from data/nodes.csv. */
  count: number;
  /** Normal-node-equivalents per node (impure 1/2, normal 1, pure 2, site = configured). */
  nne: number;
}

export interface BeltCapacity {
  tier: number;
  perMin: number;
}

export interface ModelMeta {
  schemaVersion: number;
  /** Hash of every input file; saves carry it to detect dataset changes. */
  dataHash: string;
  minerMk: number;
}

export interface Model {
  meta: ModelMeta;
  items: Item[];
  machines: Machine[];
  recipes: Recipe[];
  nodes: ResourceNode[];
  beltCapacities: BeltCapacity[];
  /** Flowchart areas in production order (A57). Absent in models built before areas. */
  areas?: Area[];
}
