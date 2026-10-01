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
});
export type OverridesConfig = z.infer<typeof OverridesConfig>;

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
