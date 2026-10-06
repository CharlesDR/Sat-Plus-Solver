/**
 * Extraction routes (docs/ARCHITECTURE.md §2.3).
 *
 * Modular Miner routes are generated from the rate model
 *   effective = max(minEffective, purity + (fluidBonus + boosterBonus) × processingMalus)
 *   baseRate  = mkRatio × effective          (mkRatio = MultiMachine PartsRatio of the Mk = A_mk × 60)
 *   output_k  = baseRate × perBase_k          (perBase from the dataset's Crusher/Smelter rows)
 *   fluidIn   = fluidBase × purity
 * with every parameter derived from the dataset or data/miner-model.json. The
 * dataset's Modular Miner rows are only used to derive and cross-check the model.
 */
import {
  MW_PART,
  PURITIES,
  excludeReason,
  maxTier,
  req,
  resolveMachine,
  type Ctx,
  type DraftRecipe,
  type RFlow,
} from './context';
import type { Purity } from './model';
import { slug } from './ids';
import { datasetFlows, isModularMinerRow, normalizeOne } from './normalize';
import {
  ONE,
  ZERO,
  add,
  div,
  eq,
  max,
  mul,
  sub,
  toNumber,
  toString,
  type Rational,
} from './rational';
import type { RawRecipe } from './raw';

type ProcessingKind = 'crusher' | 'smelter';

interface Processing {
  kind: ProcessingKind;
  product: string;
  /** Output parts per unit of base extraction (exact). */
  parts: { part: string; amount: Rational }[];
  tier: string;
  /** True when derived from a fluid+processing dataset row. */
  withFluidOnly: boolean;
}

interface FluidOption {
  fluid: string;
  bonus: Rational;
  /** m³/min at purity 1. */
  base: Rational;
  tier: string;
}

export interface Ore {
  resource: string;
  plain: boolean;
  plainTier: string;
  processing: Map<string, Processing>;
  fluids: Map<string, FluidOption>;
}

interface FluidRow {
  raw: RawRecipe;
  resource: string;
  fluid: string;
  purity: Purity;
  mk: number;
  processing: string | null;
}

export interface CrossCheckResult {
  checked: number;
  mismatches: { recipe: string; detail: string; whitelisted: boolean }[];
}

export interface ExtractionResult {
  drafts: DraftRecipe[];
  ores: Ore[];
  crossCheck: CrossCheckResult;
  /** Normal-node-equivalents per fracking site, by resource name. */
  siteNne: Map<string, Rational>;
  purity: Record<Purity, Rational>;
}

const CRUSHER_SMELTER = /^(.+?) - (.+?) \((?:MM )?(Crusher|Smelter) Module\)$/;
const FLUID_ROW =
  /^(.+?) \/ (.+?) - (impure|normal|pure) Mk\.(\d+) \(MM Fluid(\/Crusher)? Module\)$/;

export function nodeKey(resource: string, purity: Purity | 'site'): string {
  return `${resource}|${purity}`;
}

export function buildExtraction(ctx: Ctx): ExtractionResult {
  const { issues, miner } = ctx;
  const mm = miner.modularMiner;
  const group = ctx.multi.get(mm.multiMachineGroup);
  const nodeRows = new Map(ctx.nodeRows.map((r) => [r.resource, r]));

  // Purity multipliers from the miner MultiMachine capacities.
  const purity = {} as Record<Purity, Rational>;
  for (const p of PURITIES) {
    const cap = group?.Capacities?.find((c) => c.Name.toLowerCase() === p);
    if (!cap)
      issues.error('miner.purity', `MultiMachine "${mm.multiMachineGroup}" lacks capacity "${p}"`);
    purity[p] = req(ctx, cap?.PartsRatio, `purity ${p}`);
  }
  const mkRatio = (mk: number): Rational | undefined => {
    const name = mm.machines.none.replace('{mk}', String(mk));
    const entry = group?.Machines?.find((m) => m.Name === name);
    return entry ? req(ctx, entry.PartsRatio, `MultiMachine machine ${name}`) : undefined;
  };
  const malus = (kind: ProcessingKind | null): Rational =>
    kind ? req(ctx, mm.processingMalus[kind], `processingMalus.${kind}`) : ONE;
  const minEffective = req(ctx, mm.minEffective, 'modularMiner.minEffective');

  // ---- 1. Classify the dataset's Modular Miner rows. ----
  const ores = new Map<string, Ore>();
  const ore = (resource: string): Ore => {
    let o = ores.get(resource);
    if (!o) {
      o = { resource, plain: false, plainTier: '0-0', processing: new Map(), fluids: new Map() };
      ores.set(resource, o);
    }
    return o;
  };
  const oreFor = (prefix: string, where: string): string | undefined => {
    const resource = ctx.overrides.minerOres[prefix];
    if (!resource)
      issues.error('miner.ore', `${where}: no minerOres mapping for prefix "${prefix}"`);
    else if (!nodeRows.has(resource))
      issues.error('miner.ore', `${where}: resource "${resource}" is not in data/nodes.csv`);
    return resource && nodeRows.has(resource) ? resource : undefined;
  };
  const fluidRows: FluidRow[] = [];
  const baseRows: { raw: RawRecipe; resource: string; processing: string | null }[] = [];
  const fluidObservations = new Map<
    string,
    { bonus: Rational[]; base: Rational[]; tier: string }
  >();

  for (const r of ctx.data.Recipes) {
    if (!isModularMinerRow(r)) continue;
    const where = `Modular Miner row "${r.Name}"`;
    const reason = excludeReason(ctx, r);
    if (reason) {
      ctx.exclusions.push({ recipe: r.Name, reason });
      continue;
    }
    const flows = datasetFlows(ctx, r);
    if (!flows) continue;

    if (r.Machine === mm.multiMachineGroup) {
      const [out] = flows.outputs;
      if (flows.inputs.length || flows.outputs.length !== 1 || !out || !nodeRows.has(out.part)) {
        issues.error('miner.row', `${where}: plain rows must output one node resource`);
        continue;
      }
      const o = ore(out.part);
      o.plain = true;
      o.plainTier = r.Tier;
      baseRows.push({ raw: r, resource: out.part, processing: null });
      continue;
    }

    const cs = CRUSHER_SMELTER.exec(r.Name);
    if (
      cs &&
      (r.Machine === `${mm.multiMachineGroup} (Crusher)` ||
        r.Machine === `${mm.multiMachineGroup} (Smelter)`)
    ) {
      const [, prefix, product, kindText] = cs as unknown as [string, string, string, string];
      const resource = oreFor(prefix, where);
      if (!resource) continue;
      if (flows.inputs.length || flows.outputs[0]?.part !== product) {
        issues.error('miner.row', `${where}: expected first output "${product}" and no inputs`);
        continue;
      }
      // Base rows are at Mk.1 ratio applied by the MultiMachine: rate/min ÷ 1 = per base unit.
      ore(resource).processing.set(product, {
        kind: kindText.toLowerCase() as ProcessingKind,
        product,
        parts: flows.outputs.map((f) => ({ part: f.part, amount: f.rate })),
        tier: r.Tier,
        withFluidOnly: false,
      });
      baseRows.push({ raw: r, resource, processing: product });
      continue;
    }

    const fm = FLUID_ROW.exec(r.Name);
    if (fm) {
      const [, prefix, fluid, pur, mkText, crusher] = fm as unknown as [
        string,
        string,
        string,
        Purity,
        string,
        string | undefined,
      ];
      const resource = oreFor(prefix, where);
      if (!resource) continue;
      const mk = Number(mkText);
      const ratio = mkRatio(mk);
      const fluidIn = flows.inputs[0];
      const primary = flows.outputs[0];
      if (!ratio || flows.inputs.length !== 1 || fluidIn?.part !== fluid || !primary) {
        issues.error('miner.row', `${where}: expected one "${fluid}" input and a known Mk`);
        continue;
      }
      const processing = crusher ? primary.part : null;
      fluidRows.push({ raw: r, resource, fluid, purity: pur, mk, processing });
      ore(resource);
      if (!crusher) {
        if (primary.part !== resource || flows.outputs.length !== 1) {
          issues.error('miner.row', `${where}: fluid rows must output only "${resource}"`);
          continue;
        }
        const key = `${resource}|${fluid}`;
        const obs = fluidObservations.get(key) ?? { bonus: [], base: [], tier: r.Tier };
        obs.bonus.push(sub(div(primary.rate, ratio), purity[pur]));
        obs.base.push(div(fluidIn.rate, purity[pur]));
        if (maxTier(obs.tier, r.Tier) === obs.tier) obs.tier = r.Tier; // keep the lowest tier
        fluidObservations.set(key, obs);
      }
      continue;
    }

    issues.error('miner.row', `${where}: unrecognized Modular Miner row (machine "${r.Machine}")`);
  }

  // ---- 2. Fluid bonuses must be consistent across every Mk and purity. ----
  for (const [key, obs] of fluidObservations) {
    const [resource, fluid] = key.split('|') as [string, string];
    const bonus = obs.bonus[0]!;
    const base = obs.base[0]!;
    if (!obs.bonus.every((b) => eq(b, bonus)) || !obs.base.every((b) => eq(b, base))) {
      issues.error(
        'miner.fluidBonus',
        `${resource} + ${fluid}: fluid-module rows disagree on bonus/base (${obs.bonus.map(toString).join(', ')})`,
      );
      continue;
    }
    ore(resource).fluids.set(fluid, { fluid, bonus, base, tier: obs.tier });
  }

  // ---- 3. Processing that only appears together with a fluid (e.g. Sulfur Powder). ----
  for (const row of fluidRows) {
    if (!row.processing) continue;
    const o = ore(row.resource);
    if (o.processing.has(row.processing)) continue;
    const ref = fluidRows
      .filter(
        (f) =>
          f.resource === row.resource && f.processing === row.processing && f.purity === 'normal',
      )
      .sort((a, b) => a.mk - b.mk)[0];
    const option = o.fluids.get(row.fluid);
    const ratio = ref && mkRatio(ref.mk);
    const flows = ref && datasetFlows(ctx, ref.raw);
    if (!ref || !option || !ratio || !flows) {
      issues.error(
        'miner.processing',
        `${row.raw.Name}: cannot derive processing "${row.processing}"`,
      );
      continue;
    }
    const eff = max(minEffective, add(purity.normal, mul(option.bonus, malus('crusher'))));
    const baseRate = mul(ratio, eff);
    o.processing.set(row.processing, {
      kind: 'crusher',
      product: row.processing,
      parts: flows.outputs.map((f) => ({ part: f.part, amount: div(f.rate, baseRate) })),
      tier: ref.raw.Tier,
      withFluidOnly: true,
    });
  }

  // ---- 4. Rate model. ----
  const amountOverride = (resource: string, p: Purity, processing: string, part: string) =>
    ctx.overrides.routeAmountOverrides.find(
      (o) =>
        o.resource === resource && o.purity === p && o.processing === processing && o.part === part,
    );
  const compute = (
    o: Ore,
    p: Purity,
    processing: string | null,
    fluid: string | null,
    mk: number,
    booster: Rational,
  ): { outputs: RFlow[]; inputs: RFlow[]; baseRate: Rational } | undefined => {
    const ratio = mkRatio(mk);
    const proc = processing ? o.processing.get(processing) : undefined;
    const opt = fluid ? o.fluids.get(fluid) : undefined;
    if (!ratio || (processing && !proc) || (fluid && !opt)) return undefined;
    const bonus = add(opt?.bonus ?? ZERO, booster);
    const eff = max(minEffective, add(purity[p], mul(bonus, malus(proc?.kind ?? null))));
    const baseRate = mul(ratio, eff);
    const parts = proc
      ? proc.parts.map(({ part, amount }) => {
          const ov = amountOverride(o.resource, p, proc.product, part);
          return {
            part,
            amount: ov ? req(ctx, ov.amount, `routeAmountOverrides ${part}`) : amount,
          };
        })
      : [{ part: o.resource, amount: ONE }];
    return {
      outputs: parts.map(({ part, amount }) => ({ part, rate: mul(baseRate, amount) })),
      inputs: opt ? [{ part: opt.fluid, rate: mul(opt.base, purity[p]) }] : [],
      baseRate,
    };
  };

  // ---- 5. Cross-check every dataset row against the model at zero boosters. ----
  const crossCheck: CrossCheckResult = { checked: 0, mismatches: [] };
  const sameFlows = (a: RFlow[], b: RFlow[]): boolean =>
    a.length === b.length && a.every((f) => b.some((g) => g.part === f.part && eq(g.rate, f.rate)));
  const describe = (fs: RFlow[]) => fs.map((f) => `${f.part} ${toString(f.rate)}`).join(', ');
  const check = (
    raw: RawRecipe,
    got: { outputs: RFlow[]; inputs: RFlow[] } | undefined,
    scale = ONE,
  ) => {
    const flows = datasetFlows(ctx, raw, scale);
    if (!flows) return;
    crossCheck.checked++;
    if (got && sameFlows(got.outputs, flows.outputs) && sameFlows(got.inputs, flows.inputs)) return;
    const whitelisted = Boolean(ctx.overrides.crossCheckWhitelist[raw.Name]);
    const detail = `dataset [${describe(flows.outputs)} | in ${describe(flows.inputs)}] vs model [${
      got ? `${describe(got.outputs)} | in ${describe(got.inputs)}` : 'no route'
    }]`;
    crossCheck.mismatches.push({ recipe: raw.Name, detail, whitelisted });
    if (whitelisted) issues.warn('miner.crossCheck', `${raw.Name}: ${detail} (whitelisted)`);
    else
      issues.error(
        'miner.crossCheck',
        `${raw.Name}: generated route differs from dataset: ${detail}`,
      );
  };
  for (const row of fluidRows) {
    check(row.raw, compute(ore(row.resource), row.purity, row.processing, row.fluid, row.mk, ZERO));
  }
  const mk1 = mkRatio(1);
  for (const row of baseRows) {
    // Base rows are per unit of base extraction; compare at Mk.1 / normal / no fluid.
    if (mk1)
      check(row.raw, compute(ore(row.resource), 'normal', row.processing, null, 1, ZERO), mk1);
  }

  // ---- 6. Generate max-output routes at the configured Mk. ----
  const drafts: DraftRecipe[] = [];
  const booster = req(ctx, mm.boosterBonus, 'modularMiner.boosterBonus');
  const boosterPower =
    toNumber(req(ctx, mm.boosterPowerMW, 'modularMiner.boosterPowerMW')) * mm.boosterSlots;
  const machineFor = (processing: Processing | undefined, fluid: boolean) => {
    const key = (
      fluid ? (processing ? `fluid+${processing.kind}` : 'fluid') : (processing?.kind ?? 'none')
    ) as keyof typeof mm.machines;
    const name = mm.machines[key].replace('{mk}', String(mm.mk));
    const machine = ctx.machines.get(name);
    if (!machine)
      issues.error('miner.machine', `miner-model machine "${name}" is not in the dataset`);
    return machine;
  };
  if (!mkRatio(mm.mk)) issues.error('miner.mk', `No "${mm.machines.none}" entry for Mk.${mm.mk}`);

  for (const o of [...ores.values()].sort((a, b) => a.resource.localeCompare(b.resource))) {
    const counts = nodeRows.get(o.resource)!;
    const fluidChoices: (string | null)[] = [
      ...(o.plain ? [null] : []),
      ...[...o.fluids.keys()].sort(),
    ];
    const processingChoices: (string | null)[] = [null, ...[...o.processing.keys()].sort()];
    if (fluidChoices.length === 0)
      issues.error('miner.routes', `${o.resource}: no plain or fluid route`);
    for (const p of PURITIES) {
      if (counts[p] === 0) continue;
      for (const processing of processingChoices) {
        const proc = processing ? o.processing.get(processing) : undefined;
        for (const fluid of fluidChoices) {
          if (proc && fluid && !mm.allowProcessingWithFluid && !proc.withFluidOnly) continue;
          if (proc?.withFluidOnly && !fluid) continue;
          const computed = compute(o, p, processing, fluid, mm.mk, booster);
          const machine = machineFor(proc, fluid !== null);
          if (!computed || !machine) continue;
          const { baseRate, ...flows } = computed;
          const tier = maxTier(
            o.plain ? o.plainTier : '0-0',
            proc?.tier ?? '0-0',
            fluid ? o.fluids.get(fluid)!.tier : '0-0',
          );
          const label = `${processing ?? o.resource}${fluid ? ` with ${fluid}` : ''}`;
          drafts.push({
            id: [
              'mine',
              slug(o.resource),
              p,
              processing ? slug(processing) : 'raw',
              fluid ? slug(fluid) : 'dry',
            ].join(':'),
            name: `${o.resource} (${p}) → ${label}`,
            machine: machine.Name,
            kind: 'extraction',
            alternate: false,
            tier,
            ...flows,
            powerMW:
              -toNumber(req(ctx, machine.AveragePower, `machine ${machine.Name} power`)) +
              boosterPower,
            clock: 1,
            node: nodeKey(o.resource, p),
            source: 'generated',
            route: { resource: o.resource, purity: p, processing, fluid },
            baseRate,
          });
        }
      }
    }
  }

  // ---- 7. Other extractors: zero-input dataset recipes. ----
  const siteNne = new Map<string, Rational>();
  const nx = miner.nodeExtractors;
  const clock = req(ctx, nx.clock, 'nodeExtractors.clock');
  const defaultExp = toNumber(
    req(ctx, nx.defaultPowerExponent, 'nodeExtractors.defaultPowerExponent'),
  );
  const fr = miner.fracking;
  const frClock = req(ctx, fr.clock, 'fracking.clock');
  const overclockedPower = (
    machine: {
      AveragePower?: string | undefined;
      OverclockPowerExponent?: string | undefined;
      Name: string;
    },
    c: Rational,
  ) => {
    const base = -toNumber(req(ctx, machine.AveragePower, `machine ${machine.Name} power`, ZERO));
    const exp = machine.OverclockPowerExponent
      ? toNumber(req(ctx, machine.OverclockPowerExponent, `machine ${machine.Name} exponent`))
      : defaultExp;
    return base * toNumber(c) ** exp;
  };

  for (const r of ctx.data.Recipes) {
    if (isModularMinerRow(r) || r.Parts.some((p) => p.Amount.trim().startsWith('-'))) continue;
    const reason = excludeReason(ctx, r);
    if (reason) {
      ctx.exclusions.push({ recipe: r.Name, reason });
      continue;
    }
    const where = `extraction recipe "${r.Name}"`;
    const resolved = resolveMachine(ctx, r.Machine);
    const flows = resolved && datasetFlows(ctx, r, resolved.rateFactor);
    if (!resolved || !flows) {
      if (!resolved)
        issues.error('recipe.machine', `${where}: machine "${r.Machine}" does not resolve`);
      continue;
    }
    const [out] = flows.outputs;
    const row = out && nodeRows.get(out.part);
    if (!row) {
      // Unlimited resource (Water, Air, …): an ordinary recipe at 100% clock.
      const draft = normalizeOne(ctx, r);
      if (draft) drafts.push({ ...draft, kind: 'extraction' });
      continue;
    }
    if (flows.outputs.length !== 1 || flows.outputs.some((f) => f.part === MW_PART)) {
      issues.error('extract.outputs', `${where}: node extractors must output exactly one resource`);
      continue;
    }

    if (resolved.machine.Name === fr.extractorMachine) {
      if (row.sites === 0) continue;
      const pressurizer = ctx.machines.get(fr.pressurizerMachine);
      if (!pressurizer) {
        issues.error(
          'extract.fracking',
          `fracking pressurizer "${fr.pressurizerMachine}" not in dataset`,
        );
        continue;
      }
      const nne = row.siteRate
        ? div(row.siteRate, mul(out.rate, frClock))
        : req(ctx, fr.siteNormalEquivalents, 'fracking.siteNormalEquivalents');
      siteNne.set(row.resource, nne);
      drafts.push({
        id: `extract:${slug(row.resource)}:site`,
        name: `${row.resource} fracking site`,
        machine: pressurizer.Name,
        kind: 'extraction',
        alternate: false,
        tier: r.Tier,
        inputs: [],
        outputs: [{ part: out.part, rate: row.siteRate ?? mul(mul(nne, out.rate), frClock) }],
        powerMW: overclockedPower(pressurizer, frClock),
        clock: toNumber(frClock),
        node: nodeKey(row.resource, 'site'),
        source: 'generated',
      });
      continue;
    }

    for (const p of PURITIES) {
      if (row[p] === 0) continue;
      drafts.push({
        id: `extract:${slug(row.resource)}:${p}`,
        name: `${row.resource} (${p}) → ${resolved.machine.Name}`,
        machine: resolved.machine.Name,
        kind: 'extraction',
        alternate: false,
        tier: r.Tier,
        inputs: [],
        outputs: [{ part: out.part, rate: mul(mul(out.rate, purity[p]), clock) }],
        powerMW: overclockedPower(resolved.machine, clock) * toNumber(resolved.powerFactor),
        clock: toNumber(clock),
        node: nodeKey(row.resource, p),
        source: 'generated',
      });
    }
  }

  // ---- 8. Every node class with a count needs at least one route. ----
  const covered = new Set(drafts.map((d) => d.node).filter(Boolean));
  for (const row of ctx.nodeRows) {
    if (ctx.overrides.ignoredNodeResources[row.resource]) continue;
    for (const p of [...PURITIES, 'site'] as const) {
      const count = p === 'site' ? row.sites : row[p];
      if (count > 0 && !covered.has(nodeKey(row.resource, p))) {
        issues.error(
          'nodes.uncovered',
          `No extraction route for ${row.resource} (${p}, ${count} nodes)`,
        );
      }
    }
  }

  return { drafts, ores: [...ores.values()], crossCheck, siteNne, purity };
}
