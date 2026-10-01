import {
  MW_PART,
  excludeReason,
  req,
  resolveMachine,
  type Ctx,
  type DraftRecipe,
  type RFlow,
} from './context';
import { abs, cmp, div, isNegative, isZero, mul, rat, toNumber, ZERO } from './rational';
import type { RawRecipe } from './raw';

/** True for rows owned by the Modular Miner route generator (extraction.ts). */
export function isModularMinerRow(r: RawRecipe): boolean {
  return r.Machine.startsWith('Modular Miner');
}

/** Per-minute flows of a dataset recipe: |amount| × 60 / batchTime × rateFactor. */
export function datasetFlows(
  ctx: Ctx,
  r: RawRecipe,
  rateFactor = rat(1),
): { inputs: RFlow[]; outputs: RFlow[] } | undefined {
  const where = `recipe "${r.Name}"`;
  const batch = req(ctx, r.BatchTime, `${where} BatchTime`, ZERO);
  if (cmp(batch, ZERO) <= 0) {
    ctx.issues.error('recipe.batchTime', `${where}: BatchTime must be > 0 (got "${r.BatchTime}")`);
    return undefined;
  }
  const perMin = mul(div(rat(60), batch), rateFactor);
  const inputs: RFlow[] = [];
  const outputs: RFlow[] = [];
  let ok = true;
  for (const p of r.Parts) {
    if (!ctx.parts.has(p.Part)) {
      ctx.issues.error('recipe.unknownPart', `${where}: unknown part "${p.Part}"`);
      ok = false;
      continue;
    }
    const amount = req(ctx, p.Amount, `${where} part "${p.Part}" Amount`, ZERO);
    if (isZero(amount)) {
      ctx.issues.warn('recipe.zeroAmount', `${where}: part "${p.Part}" has amount 0; ignored`);
      continue;
    }
    const flow = { part: p.Part, rate: mul(abs(amount), perMin) };
    (isNegative(amount) ? inputs : outputs).push(flow);
  }
  return ok ? { inputs, outputs } : undefined;
}

/** Recipe power in MW (positive = draw) from recipe- or machine-level AveragePower. */
function powerOf(ctx: Ctx, r: RawRecipe, machineAverage: string | undefined): number | undefined {
  const where = `recipe "${r.Name}"`;
  if (r.MinPower !== undefined && r.AveragePower !== undefined) {
    const min = req(ctx, r.MinPower, `${where} MinPower`);
    const avg = req(ctx, r.AveragePower, `${where} AveragePower`);
    if (cmp(abs(min), abs(avg)) < 0) {
      ctx.issues.warn(
        'power.swapped',
        `${where}: MinPower ${r.MinPower} is smaller than AveragePower ${r.AveragePower} (A1); AveragePower is used`,
      );
    }
  }
  const text = r.AveragePower ?? machineAverage;
  if (text === undefined) return undefined;
  return -toNumber(req(ctx, text, `${where} power`));
}

/**
 * Normalizes every dataset recipe that is not excluded, not a Modular Miner row
 * and not a zero-input extraction recipe (those are handled by extraction.ts).
 */
export function normalizeDatasetRecipes(ctx: Ctx): DraftRecipe[] {
  const drafts: DraftRecipe[] = [];
  for (const r of ctx.data.Recipes) {
    // Modular Miner rows and zero-input extraction recipes belong to extraction.ts.
    if (isModularMinerRow(r) || !r.Parts.some((p) => p.Amount.trim().startsWith('-'))) continue;
    const reason = excludeReason(ctx, r);
    if (reason) {
      ctx.exclusions.push({ recipe: r.Name, reason });
      continue;
    }
    const draft = normalizeOne(ctx, r);
    if (draft) drafts.push(draft);
  }
  return drafts;
}

export function normalizeOne(ctx: Ctx, r: RawRecipe): DraftRecipe | undefined {
  const where = `recipe "${r.Name}"`;
  const resolved = resolveMachine(ctx, r.Machine);
  if (!resolved) {
    ctx.issues.error('recipe.machine', `${where}: machine "${r.Machine}" does not resolve`);
    return undefined;
  }
  const flows = datasetFlows(ctx, r, resolved.rateFactor);
  if (!flows) return undefined;
  const { machine } = resolved;
  let powerMW = powerOf(ctx, r, machine.AveragePower);
  if (powerMW === undefined) {
    ctx.issues.error('recipe.power', `${where}: neither recipe nor machine defines AveragePower`);
    return undefined;
  }
  powerMW *= toNumber(resolved.powerFactor);

  let kind: DraftRecipe['kind'] = 'production';
  const generator = ctx.overrides.generatorOverrides[machine.Name];
  const generationMW = generator
    ? toNumber(req(ctx, generator.generationMW, `generatorOverrides.${machine.Name}`))
    : -powerMW;
  if (generationMW > 0) {
    kind = 'generator';
    powerMW = -generationMW;
    flows.outputs.push({ part: MW_PART, rate: rat(Math.round(generationMW * 1e6), 1e6) });
  }

  if (ctx.overrides.virtualTargetMachines[machine.Name] && flows.outputs.length === 0) {
    // One delivery per batch becomes one unit of a virtual target item.
    ctx.virtualItems.set(r.Name, r.Tier);
    const batch = req(ctx, r.BatchTime, `${where} BatchTime`);
    flows.outputs.push({ part: r.Name, rate: div(rat(60), batch) });
  }

  if (flows.outputs.length === 0) {
    ctx.exclusions.push({
      recipe: r.Name,
      reason: 'Consumes only; surplus is free disposal, so a pure sink is never useful.',
    });
    return undefined;
  }

  return {
    raw: r,
    name: r.Name,
    machine: machine.Name,
    kind,
    alternate: r.Alternate === true,
    tier: r.Tier,
    ...flows,
    powerMW,
    clock: 1,
    source: 'dataset',
  };
}
