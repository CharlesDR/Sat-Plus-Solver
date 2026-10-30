import { z } from 'zod';

/**
 * Schema for the raw SF+ dataset (`game_data.json`, described by
 * `data.schema.json`). Unknown keys are kept (`looseObject`) because the file
 * carries editor tags and flags the pipeline only partly uses.
 */
const PartAmount = z.looseObject({ Part: z.string().min(1), Amount: z.string().min(1) });

export const RawMachine = z.looseObject({
  Name: z.string().min(1),
  Tier: z.string(),
  Cost: z.array(PartAmount),
  AveragePower: z.string().optional(),
  MinPower: z.string().optional(),
  BasePower: z.string().optional(),
  OverclockPowerExponent: z.string().optional(),
});

const RawMultiMachineEntry = z.looseObject({
  Name: z.string().min(1),
  PartsRatio: z.string().optional(),
  PowerRatio: z.string().optional(),
  Default: z.boolean().optional(),
});

export const RawMultiMachine = z.looseObject({
  Name: z.string().min(1),
  Machines: z.array(RawMultiMachineEntry).optional(),
  Capacities: z.array(RawMultiMachineEntry).optional(),
});

export const RawPart = z.looseObject({
  Name: z.string().min(1),
  Tier: z.string(),
  SinkPoints: z.number(),
  Fluid: z.boolean().optional(),
});

export const RawRecipe = z.looseObject({
  Name: z.string().min(1),
  Machine: z.string().min(1),
  BatchTime: z.string().min(1),
  Tier: z.string(),
  Parts: z.array(PartAmount),
  Alternate: z.boolean().optional(),
  MinPower: z.string().optional(),
  AveragePower: z.string().optional(),
});

export const RawGameData = z.looseObject({
  Machines: z.array(RawMachine),
  MultiMachines: z.array(RawMultiMachine),
  Parts: z.array(RawPart),
  Recipes: z.array(RawRecipe),
});

export type RawGameData = z.infer<typeof RawGameData>;
export type RawRecipe = z.infer<typeof RawRecipe>;
export type RawMachine = z.infer<typeof RawMachine>;
export type RawMultiMachine = z.infer<typeof RawMultiMachine>;
export type RawPart = z.infer<typeof RawPart>;

const RationalString = z.string().min(1);

export const MinerModelConfig = z.object({
  modularMiner: z.object({
    multiMachineGroup: z.string(),
    mk: z.number().int().min(1),
    beltOutputs: z.number().int().min(1),
    boosterBonus: RationalString,
    boosterSlots: z.number().int().min(0),
    boosterPowerMW: RationalString,
    minEffective: RationalString,
    processingMalus: z.object({ crusher: RationalString, smelter: RationalString }),
    allowProcessingWithFluid: z.boolean(),
    machines: z.object({
      none: z.string(),
      crusher: z.string(),
      smelter: z.string(),
      fluid: z.string(),
      'fluid+crusher': z.string(),
      'fluid+smelter': z.string(),
    }),
    /** DF-1 (A98): unlock tier per drill Mk and per module; ores that need a better drill. */
    unlocks: z.object({
      drills: z.record(z.string().regex(/^\d+$/), z.string().regex(/^\d+-\d+$/)),
      modules: z.object({
        smelter: z.string().regex(/^\d+-\d+$/),
        crusher: z.string().regex(/^\d+-\d+$/),
        fluid: z.string().regex(/^\d+-\d+$/),
      }),
      minDrill: z.record(z.string(), z.number().int().min(1)),
    }),
  }),
  nodeExtractors: z.object({ clock: RationalString, defaultPowerExponent: RationalString }),
  fracking: z.object({
    extractorMachine: z.string(),
    pressurizerMachine: z.string(),
    siteNormalEquivalents: RationalString,
    clock: RationalString,
  }),
});
export type MinerModelConfig = z.infer<typeof MinerModelConfig>;

const Reasons = z.record(z.string(), z.string());

export const OverridesConfig = z.object({
  markAsFluid: Reasons,
  excludeMachines: Reasons,
  excludeRecipeFlags: Reasons,
  excludeRecipes: Reasons,
  excludeRecipesUsingParts: Reasons,
  ignoredNodeResources: Reasons,
  minerOres: z.record(z.string(), z.string()),
  routeAmountOverrides: z.array(
    z.object({
      resource: z.string(),
      purity: z.enum(['impure', 'normal', 'pure']),
      processing: z.string(),
      part: z.string(),
      amount: RationalString,
      reason: z.string(),
    }),
  ),
  crossCheckWhitelist: Reasons,
  generatorOverrides: z.record(
    z.string(),
    z.object({ generationMW: RationalString, reason: z.string() }),
  ),
  virtualTargetMachines: Reasons,
  freeLunchWhitelist: Reasons,
  heaterMachines: Reasons,
  boilerPairs: z.array(
    z.object({ input: z.string(), output: z.string(), ratio: RationalString, reason: z.string() }),
  ),
  /** Milestone tier per dataset recipe name, where the dataset's `Tier` is wrong (A83). */
  recipeTiers: z.record(
    z.string(),
    z.object({ tier: z.string().regex(/^\d+-\d+$/), reason: z.string() }),
  ),
});
export type OverridesConfig = z.infer<typeof OverridesConfig>;

/** data/areas.json: the flowchart's areas and the parts listed in each (A62). */
export const AreasConfig = z.object({
  /** Resources left out when signatures are compared (Water, Air). */
  utility: z.array(z.string()),
  areas: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      name: z.string().min(1),
      /** `raw`: raw resources and one step on. `targets`: recipes making a target. `fallback`: the rest. */
      rule: z.enum(['raw', 'targets', 'fallback']).optional(),
      /** Unlisted items whose raw resources are exactly these (utility aside) join this area. */
      signature: z.array(z.string()).optional(),
      items: z.array(z.string()),
    }),
  ),
});
export type AreasConfig = z.infer<typeof AreasConfig>;

/** data/alternate-unlocks.json: how each alternate recipe is unlocked (D1, A82). */
export const AlternateUnlocksConfig = z.object({
  alternates: z.array(
    z.object({
      /** game_data.json recipe name. */
      recipe: z.string().min(1),
      unlock: z.enum(['mam', 'hard-drive']),
      schematic: z.string().min(1),
      /** The unlock tier, given: a hard drive's milestone, or worked out by hand. */
      tier: z.number().int().min(0).optional(),
      /** Research costs (game_data.json parts): the unlock tier is their highest major tier. */
      costs: z.array(z.string()).optional(),
    }),
  ),
});
export type AlternateUnlocksConfig = z.infer<typeof AlternateUnlocksConfig>;

/**
 * data/scarcity-usage.json: a likely-usage factor per node resource for O2
 * (A85). A resource left out has usage 1. Every value carries its reason.
 */
export const ScarcityUsageConfig = z.object({
  usage: z.record(
    z.string(),
    z.object({ usage: z.number().positive().finite(), reason: z.string().min(1) }),
  ),
});
export type ScarcityUsageConfig = z.infer<typeof ScarcityUsageConfig>;

/** Drops `$`-prefixed documentation keys before schema validation. */
export function stripComments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripComments);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !k.startsWith('$'))
        .map(([k, v]) => [k, stripComments(v)]),
    );
  }
  return value;
}
