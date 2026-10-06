import type { Issues } from './issues';
import type { NodeRow } from './nodes';
import { ONE, mul, parseRational, type Rational } from './rational';
import type {
  MinerModelConfig,
  OverridesConfig,
  RawGameData,
  RawMachine,
  RawMultiMachine,
  RawRecipe,
} from './raw';
import type { MinerRoute, Purity, RecipeKind } from './model';

/** A flow in exact arithmetic, keyed by part *name* until ids are assigned. */
export interface RFlow {
  part: string;
  rate: Rational; // per machine per minute (MW for the power pseudo-item), > 0
  /** Heater side of a heater recipe (A17). */
  heater?: true;
}

/** Pre-emission recipe: exact rates, names instead of ids. */
export interface DraftRecipe {
  /** Dataset recipes get slug-of-name ids (hash on collision); generated ones carry their id. */
  raw?: RawRecipe;
  id?: string;
  name: string;
  machine: string;
  kind: RecipeKind;
  alternate: boolean;
  tier: string;
  inputs: RFlow[];
  outputs: RFlow[];
  powerMW: number;
  clock: number;
  /** Node key `${resource}|${purity}` for node-limited extraction. */
  node?: string;
  source: 'dataset' | 'generated';
  /** Generated Modular Miner route, with part names (converted to ids on emission). */
  route?: MinerRoute;
  /** Modular Miner routes: base extraction per machine (A33). Other extractors use their output. */
  baseRate?: Rational;
  /** Heater/boiler recipe (A17). */
  heater?: true;
}

export const PURITIES: readonly Purity[] = ['impure', 'normal', 'pure'];

/** Name of the power pseudo-item while flows are keyed by part name. */
export const MW_PART = '\u0000MW';

export interface ResolvedMachine {
  machine: RawMachine;
  /** Multiplier on dataset rates from the MultiMachine default machine/capacity. */
  rateFactor: Rational;
  powerFactor: Rational;
}

export interface Ctx {
  issues: Issues;
  data: RawGameData;
  miner: MinerModelConfig;
  overrides: OverridesConfig;
  nodeRows: NodeRow[];
  parts: Map<string, RawGameData['Parts'][number]>;
  machines: Map<string, RawMachine>;
  multi: Map<string, RawMultiMachine>;
  /** Virtual target items created from sink recipes (name → tier). */
  virtualItems: Map<string, string>;
  /** Recipes skipped by overrides, with reasons (for the report). */
  exclusions: { recipe: string; reason: string }[];
}

/** Parses a rational config/dataset string, recording an error on failure. */
export function req(ctx: Ctx, text: string | undefined, where: string, fallback = ONE): Rational {
  if (text === undefined) return fallback;
  const r = parseRational(text);
  if (!r) {
    ctx.issues.error('number', `${where}: cannot parse "${text}" as a number`);
    return fallback;
  }
  return r;
}

function defaultEntry<T extends { Default?: boolean | undefined }>(
  list: readonly T[] | undefined,
): T | undefined {
  return list?.find((e) => e.Default) ?? list?.[0];
}

export function resolveMachine(ctx: Ctx, name: string): ResolvedMachine | undefined {
  const group = ctx.multi.get(name);
  const capacity = defaultEntry(group?.Capacities);
  const capRate = req(ctx, capacity?.PartsRatio, `MultiMachine ${name} capacity`);
  const capPower = req(ctx, capacity?.PowerRatio, `MultiMachine ${name} capacity power`);
  const direct = ctx.machines.get(name);
  if (direct) return { machine: direct, rateFactor: capRate, powerFactor: capPower };
  const entry = defaultEntry(group?.Machines);
  const machine = entry && ctx.machines.get(entry.Name);
  if (!entry || !machine) return undefined;
  const entryRate = req(ctx, entry.PartsRatio, `MultiMachine ${name} machine ${entry.Name}`);
  return { machine, rateFactor: mul(entryRate, capRate), powerFactor: capPower };
}

/** "5-2" → [5, 2] for ordering tiers. */
export function tierKey(tier: string): [number, number] {
  const [a = '0', b = '0'] = tier.split('-');
  return [Number(a) || 0, Number(b) || 0];
}

export function maxTier(...tiers: string[]): string {
  return tiers.reduce((best, t) => {
    const [a, b] = tierKey(t);
    const [x, y] = tierKey(best);
    return a > x || (a === x && b > y) ? t : best;
  }, '0-0');
}

export function excludeReason(ctx: Ctx, r: RawRecipe): string | undefined {
  const o = ctx.overrides;
  if (o.excludeMachines[r.Machine]) return o.excludeMachines[r.Machine];
  if (o.excludeRecipes[r.Name]) return o.excludeRecipes[r.Name];
  for (const [flag, reason] of Object.entries(o.excludeRecipeFlags)) {
    if ((r as Record<string, unknown>)[flag] === true) return reason;
  }
  for (const p of r.Parts) {
    if (o.excludeRecipesUsingParts[p.Part]) return o.excludeRecipesUsingParts[p.Part];
  }
  return undefined;
}
