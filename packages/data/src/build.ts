import { MW_PART, PURITIES, type Ctx, type DraftRecipe } from './context';
import { buildExtraction, type ExtractionResult } from './extraction';
import { assignIds, shortHash, slug } from './ids';
import { Issues, type Issue } from './issues';
import {
  MODEL_SCHEMA_VERSION,
  MW_ITEM_ID,
  type BeltCapacity,
  type Item,
  type Machine,
  type Model,
  type Recipe,
  type ResourceNode,
} from './model';
import { parseNodesCsv } from './nodes';
import { normalizeDatasetRecipes } from './normalize';
import { ZERO, isNegative, isZero, parseRational, toNumber, type Rational } from './rational';
import { MinerModelConfig, OverridesConfig, RawGameData, stripComments } from './raw';

/** Raw text of every pipeline input (docs/ARCHITECTURE.md §6). */
export interface BuildInputs {
  gameData: string;
  nodesCsv: string;
  minerModel: string;
  overrides: string;
}

export interface BuildResult {
  /** Present only when there are no errors. */
  model?: Model;
  issues: Issue[];
  /** Details for the build report. */
  details?: BuildDetails;
}

export interface BuildDetails {
  extraction: ExtractionResult;
  overrides: OverridesConfig;
  exclusions: { recipe: string; reason: string }[];
  unusedParts: string[];
  /** Largest fluid rate seen, for the magnitude check. */
  maxFluidRate: number;
}

/** Fluid rates above this are assumed to be in litres, not m³ (§6). */
export const MAX_FLUID_RATE = 1e4;

function parseJson(issues: Issues, text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    issues.error('json', `${file}: invalid JSON (${(e as Error).message})`);
    return undefined;
  }
}

function schemaErrors(
  issues: Issues,
  file: string,
  error: { issues: { path: PropertyKey[]; message: string }[] },
) {
  for (const i of error.issues.slice(0, 20)) {
    issues.error('schema', `${file}: ${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
  }
}

export function buildModel(inputs: BuildInputs): BuildResult {
  const issues = new Issues();
  const rawGame = RawGameData.safeParse(parseJson(issues, inputs.gameData, 'game_data.json'));
  const rawMiner = MinerModelConfig.safeParse(
    stripComments(parseJson(issues, inputs.minerModel, 'data/miner-model.json')),
  );
  const rawOverrides = OverridesConfig.safeParse(
    stripComments(parseJson(issues, inputs.overrides, 'data/overrides.json')),
  );
  if (!rawGame.success) schemaErrors(issues, 'game_data.json', rawGame.error);
  if (!rawMiner.success) schemaErrors(issues, 'data/miner-model.json', rawMiner.error);
  if (!rawOverrides.success) schemaErrors(issues, 'data/overrides.json', rawOverrides.error);
  const nodeRows = parseNodesCsv(inputs.nodesCsv, issues);
  if (!rawGame.success || !rawMiner.success || !rawOverrides.success)
    return { issues: issues.list };

  const data = rawGame.data;
  const ctx: Ctx = {
    issues,
    data,
    miner: rawMiner.data,
    overrides: rawOverrides.data,
    nodeRows: [],
    parts: new Map(data.Parts.map((p) => [p.Name, p])),
    machines: new Map(data.Machines.map((m) => [m.Name, m])),
    multi: new Map(data.MultiMachines.map((m) => [m.Name, m])),
    virtualItems: new Map(),
    exclusions: [],
  };
  for (const [map, list, what] of [
    [ctx.parts, data.Parts, 'part'],
    [ctx.machines, data.Machines, 'machine'],
  ] as const) {
    if (map.size !== list.length)
      issues.error('dataset.duplicate', `Duplicate ${what} names in game_data.json`);
  }

  // Node rows must name a part, unless explicitly ignored.
  for (const row of nodeRows) {
    if (ctx.overrides.ignoredNodeResources[row.resource]) continue;
    if (!ctx.parts.has(row.resource)) {
      issues.error(
        'nodes.unknownResource',
        `data/nodes.csv: "${row.resource}" is not a part in game_data.json`,
      );
      continue;
    }
    ctx.nodeRows.push(row);
  }

  // Heater machines (A17): every listed machine exists, and no "Heater" is left unlisted.
  for (const name of Object.keys(ctx.overrides.heaterMachines))
    if (!ctx.machines.has(name))
      issues.error(
        'override.unknownMachine',
        `overrides.heaterMachines: unknown machine "${name}"`,
      );
  for (const m of data.Machines)
    if (
      /heater/i.test(m.Name) &&
      !ctx.overrides.heaterMachines[m.Name] &&
      !ctx.overrides.excludeMachines[m.Name]
    )
      issues.error(
        'heater.unclassified',
        `Machine "${m.Name}" looks like a heater but is not in overrides.heaterMachines (A17)`,
      );
  for (const p of ctx.overrides.boilerPairs)
    for (const part of [p.input, p.output])
      if (!ctx.parts.has(part))
        issues.error('override.unknownPart', `overrides.boilerPairs: unknown part "${part}"`);

  const drafts: DraftRecipe[] = normalizeDatasetRecipes(ctx);
  const extraction = buildExtraction(ctx);
  drafts.push(...extraction.drafts);

  // ---- Items ----
  for (const name of Object.keys(ctx.overrides.markAsFluid)) {
    const part = ctx.parts.get(name);
    if (!part)
      issues.error('override.unknownPart', `overrides.markAsFluid: unknown part "${name}"`);
    else if (part.Fluid)
      issues.warn('override.redundant', `overrides.markAsFluid: "${name}" is already a fluid`);
  }
  const isFluid = (p: { Name: string; Fluid?: boolean | undefined }) =>
    p.Fluid === true || Boolean(ctx.overrides.markAsFluid[p.Name]);
  const items: Item[] = data.Parts.map((p) => ({
    id: slug(p.Name),
    name: p.Name,
    form: isFluid(p) ? 'fluid' : 'solid',
    sinkPoints: p.SinkPoints,
    tier: p.Tier,
  }));
  items.push({ id: MW_ITEM_ID, name: 'Power', form: 'power', sinkPoints: 0, tier: '0-0' });
  for (const [name, tier] of ctx.virtualItems) {
    if (ctx.parts.has(name))
      issues.error('virtual.collision', `Virtual target "${name}" collides with a part`);
    items.push({ id: `virtual:${slug(name)}`, name, form: 'virtual', sinkPoints: 0, tier });
  }
  const itemId = new Map<string, string>(items.map((i) => [i.name, i.id]));
  itemId.set(MW_PART, MW_ITEM_ID);
  const seenItemIds = new Set<string>();
  for (const i of items) {
    if (seenItemIds.has(i.id)) issues.error('ids.item', `Item id "${i.id}" is not unique`);
    seenItemIds.add(i.id);
  }

  // ---- Recipe ids: slug of name, hash suffix on collision; generated ids are explicit. ----
  const datasetDrafts = drafts.filter((d) => d.raw);
  const datasetIds = assignIds(
    datasetDrafts,
    (d) => d.name,
    (d) => JSON.stringify(d.raw),
  );
  const recipeIds = new Set<string>();
  const machinesUsed = new Map<string, Machine>();
  let maxFluidRate = 0;
  const fluidParts = new Set(data.Parts.filter(isFluid).map((p) => p.Name));

  const toFlows = (flows: { part: string; rate: Rational; heater?: true }[]) =>
    flows.map((f) => {
      if (f.part !== MW_PART && fluidParts.has(f.part))
        maxFluidRate = Math.max(maxFluidRate, toNumber(f.rate));
      return {
        item: itemId.get(f.part)!,
        rate: toNumber(f.rate),
        ...(f.heater ? { heater: true as const } : {}),
      };
    });

  const recipes: Recipe[] = [];
  for (const d of drafts) {
    const id = d.raw ? datasetIds.get(d)! : d.id!;
    if (recipeIds.has(id)) issues.error('ids.recipe', `Recipe id "${id}" is not unique`);
    recipeIds.add(id);
    const machine = ctx.machines.get(d.machine)!;
    const machineId = slug(machine.Name);
    if (!machinesUsed.has(machineId)) {
      machinesUsed.set(machineId, {
        id: machineId,
        name: machine.Name,
        powerMW: -toNumber(parseRational(machine.AveragePower ?? '0') ?? ZERO),
      });
    }
    const recipe: Recipe = {
      id,
      name: d.name,
      machine: machineId,
      kind: d.kind,
      alternate: d.alternate,
      tier: d.tier,
      inputs: toFlows(d.inputs),
      outputs: toFlows(d.outputs),
      powerMW: d.powerMW,
      clock: d.clock,
      source: d.source,
      ...(d.heater ? { heater: true as const } : {}),
    };
    if (d.node) {
      const [resource, purity] = d.node.split('|') as [string, string];
      recipe.node = nodeId(resource, purity);
    }
    if (d.kind === 'extraction') {
      // A33: what the resource limit counts. The resource is the node's (or,
      // for an unlimited extractor, its one output).
      const resource = d.node ? d.node.split('|')[0]! : d.outputs[0]?.part;
      const out = d.outputs.find((f) => f.part === resource);
      const rate = d.baseRate ?? out?.rate;
      if (resource === undefined || rate === undefined)
        issues.error('extract.resource', `${d.name}: cannot tell which resource it extracts`);
      else recipe.extracts = { item: itemId.get(resource)!, rate: toNumber(rate) };
    }
    if (d.route) {
      recipe.route = {
        resource: itemId.get(d.route.resource)!,
        purity: d.route.purity,
        processing: d.route.processing === null ? null : itemId.get(d.route.processing)!,
        fluid: d.route.fluid === null ? null : itemId.get(d.route.fluid)!,
      };
    }
    recipes.push(recipe);
  }
  recipes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (maxFluidRate > MAX_FLUID_RATE) {
    issues.error(
      'units.fluid',
      `A fluid rate of ${maxFluidRate}/min exceeds ${MAX_FLUID_RATE}; fluids look like litres, not m³`,
    );
  }

  // ---- Nodes ----
  const nodes: ResourceNode[] = [];
  for (const row of ctx.nodeRows) {
    for (const p of PURITIES) {
      if (row[p] === 0) continue;
      nodes.push({
        id: nodeId(row.resource, p),
        resource: itemId.get(row.resource)!,
        purity: p,
        count: row[p],
        nne: toNumber(extraction.purity[p]),
      });
    }
    if (row.sites > 0) {
      const nne = extraction.siteNne.get(row.resource);
      nodes.push({
        id: nodeId(row.resource, 'site'),
        resource: itemId.get(row.resource)!,
        purity: 'site',
        count: row.sites,
        nne: nne ? toNumber(nne) : 0,
      });
    }
  }

  // ---- Belt capacities: MultiMachine capacities named "Mk.N Belt". ----
  const beltCapacities: BeltCapacity[] = [];
  for (const mm of data.MultiMachines) {
    for (const c of mm.Capacities ?? []) {
      const m = /^Mk\.(\d+) Belt$/.exec(c.Name);
      const rate = c.PartsRatio ? parseRational(c.PartsRatio) : undefined;
      if (m && rate && !isZero(rate) && !isNegative(rate)) {
        if (!beltCapacities.some((b) => b.tier === Number(m[1]))) {
          beltCapacities.push({ tier: Number(m[1]), perMin: toNumber(rate) });
        }
      }
    }
  }
  beltCapacities.sort((a, b) => a.tier - b.tier);
  if (beltCapacities.length === 0)
    issues.warn('belts.missing', 'No belt capacities found in MultiMachines');

  // ---- Unused parts (warning only). ----
  const used = new Set(recipes.flatMap((r) => [...r.inputs, ...r.outputs].map((f) => f.item)));
  const unusedParts = items.filter((i) => i.form !== 'power' && !used.has(i.id)).map((i) => i.name);

  const details: BuildDetails = {
    extraction,
    overrides: ctx.overrides,
    exclusions: ctx.exclusions,
    unusedParts,
    maxFluidRate,
  };
  if (issues.errors.length > 0) return { issues: issues.list, details };

  const model: Model = {
    meta: {
      schemaVersion: MODEL_SCHEMA_VERSION,
      dataHash: shortHash(
        [inputs.gameData, inputs.nodesCsv, inputs.minerModel, inputs.overrides].join('\u0000'),
        16,
      ),
      minerMk: ctx.miner.modularMiner.mk,
    },
    items,
    machines: [...machinesUsed.values()].sort((a, b) => a.id.localeCompare(b.id)),
    recipes,
    nodes,
    beltCapacities,
  };
  return { model, issues: issues.list, details };
}

export function nodeId(resource: string, purity: string): string {
  return `node:${slug(resource)}:${purity}`;
}
