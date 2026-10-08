/**
 * Manual mode (docs/ARCHITECTURE.md §4.7, A36): a factory's plan frozen and
 * edited by hand. Its flows are plain arithmetic on the machine counts, so no
 * solve runs. What it needs beyond its import caps is reported as missing;
 * what it makes goes to its targets first, then its outgoing links, and the
 * rest is surplus. Pure.
 */
import type { Model, Recipe } from '@sps/data';
import {
  objectiveStack,
  type ItemFlow,
  type ItemRate,
  type NodeUsage,
  type RecipeUsage,
  type ResourceExtraction,
  type SolveRequest,
  type SolveResult,
} from '@sps/solver';
import type { ManualEntry, ManualPlan, World } from './document';
import { WorldEditError } from './editing';

/** Below this (per minute, or machines), a flow or a count is rounding noise. */
const EPS = 1e-9;

const byRecipe = (a: ManualEntry, b: ManualEntry) =>
  a.recipe < b.recipe ? -1 : a.recipe > b.recipe ? 1 : 0;

/** The plan as edited: the frozen entries with every edit applied, sorted, without removed groups. */
export function manualEntries(plan: Pick<ManualPlan, 'frozen' | 'edits'>): ManualEntry[] {
  const m = new Map(plan.frozen.map((e) => [e.recipe, e.machines]));
  for (const e of plan.edits) m.set(e.recipe, e.machines);
  return [...m]
    .filter(([, machines]) => machines > EPS)
    .map(([recipe, machines]) => ({ recipe, machines }))
    .sort(byRecipe);
}

// Editing (A36). Each returns a new world and leaves the others' factories alone.

function editManual(
  world: World,
  factoryId: string,
  edit: (m: ManualPlan | undefined) => ManualPlan | undefined,
): World {
  const f = world.factories.find((x) => x.id === factoryId);
  if (!f) throw new WorldEditError(`Unknown factory "${factoryId}".`);
  const manual = edit(f.manual);
  if (manual === f.manual) return world;
  const next = { ...f };
  if (manual) next.manual = manual;
  else delete next.manual;
  return { ...world, factories: world.factories.map((x) => (x.id === factoryId ? next : x)) };
}

const cleanEntries = (entries: readonly ManualEntry[]): ManualEntry[] => {
  for (const e of entries)
    if (!Number.isFinite(e.machines) || e.machines < 0)
      throw new WorldEditError(`Machine count for ${e.recipe} must be 0 or more.`);
  return entries
    .filter((e) => e.machines > EPS)
    .map((e) => ({ recipe: e.recipe, machines: e.machines }))
    .sort(byRecipe);
};

/**
 * Switches a factory to manual mode. A stored manual plan comes back as it
 * was; otherwise `plan` (the current solved plan) is frozen.
 */
export function enterManual(world: World, factoryId: string, plan: readonly ManualEntry[]): World {
  return editManual(world, factoryId, (m) =>
    m
      ? m.enabled
        ? m
        : { ...m, enabled: true }
      : { enabled: true, frozen: cleanEntries(plan), edits: [] },
  );
}

/** Back to the solver; the manual plan is kept for next time. */
export function leaveManual(world: World, factoryId: string): World {
  return editManual(world, factoryId, (m) => (m?.enabled ? { ...m, enabled: false } : m));
}

/** Throws the manual plan away (and leaves manual mode). */
export function discardManual(world: World, factoryId: string): World {
  return editManual(world, factoryId, () => undefined);
}

/**
 * Sets one recipe group's machine count in manual mode: 0 removes it, a
 * recipe not in the plan is added. Setting the count it already has changes
 * nothing.
 */
export function setManualCount(
  world: World,
  factoryId: string,
  recipe: string,
  machines: number,
): World {
  const [entry] = cleanEntries([{ recipe, machines }]);
  return editManual(world, factoryId, (m) => {
    if (!m?.enabled) throw new WorldEditError(`Factory "${factoryId}" is not in manual mode.`);
    const now = manualEntries(m).find((e) => e.recipe === recipe)?.machines ?? 0;
    const to = entry?.machines ?? 0;
    if (Math.abs(now - to) <= EPS) return m;
    return { ...m, edits: [...m.edits, { recipe, machines: to }] };
  });
}

/** Undoes the most recent manual edit. */
export function undoManual(world: World, factoryId: string): World {
  return editManual(world, factoryId, (m) =>
    m?.edits.length ? { ...m, edits: m.edits.slice(0, -1) } : m,
  );
}

/** Drops every manual edit: back to the plan as it was frozen. */
export function revertManual(world: World, factoryId: string): World {
  return editManual(world, factoryId, (m) => (m?.edits.length ? { ...m, edits: [] } : m));
}

// Arithmetic.

/** A manual plan's flows, and how its supply and demand were matched. */
export interface ManualOutcome {
  /**
   * The plan as a solve result, so ledgers, graphs and tables read it as
   * they read a solved plan: `imports` include what is missing, `surplus` what
   * nothing takes, and each item's `demand` is what its targets and links get.
   */
  result: SolveResult;
  /** Needed beyond every import cap, per item, sorted. */
  missing: ItemRate[];
  /** Per target item: what it gets. */
  targets: ItemRate[];
  /** Per item: what is left for the outgoing links after the targets. */
  forLinks: Map<string, number>;
}

/**
 * The arithmetic of a manual plan under a world request: `request.targets`
 * are served first, then `request.demand` (outgoing links); `request.imports`
 * caps what may come in, and the rest of a shortfall is missing. Unknown
 * recipes are skipped.
 */
export function manualOutcome(
  model: Pick<Model, 'recipes' | 'nodes'>,
  entries: readonly ManualEntry[],
  request: SolveRequest,
): ManualOutcome {
  const recipes = new Map<string, Recipe>(model.recipes.map((r) => [r.id, r]));
  const nne = new Map(model.nodes.map((n) => [n.id, n.nne]));
  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  // Fluid miner routes draw, supplied from outside when the request says so (A69).
  const minerDraw = new Map<string, number>();
  const outside = request.minerFluidSupply === 'outside';
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const usage: RecipeUsage[] = [];
  const nodeUse = new Map<string, number>();
  const extracted = new Map<string, number>();
  let consumptionMW = 0;
  let generationMW = 0;
  for (const e of entries) {
    const r = recipes.get(e.recipe);
    if (!r || !(e.machines > EPS)) continue;
    const n = e.machines;
    // Heaters (A17): fuel and exhaust for every whole heater, the boiler pair at n.
    const whole = Math.ceil(n - 1e-6);
    const rate = (f: Recipe['inputs'][number]) => f.rate * (f.heater ? whole : n);
    const inputs = r.inputs.map((f) => ({ item: f.item, rate: rate(f) }));
    const outputs = r.outputs.map((f) => ({ item: f.item, rate: rate(f) }));
    for (const f of outputs) add(produced, f.item, f.rate);
    for (const f of inputs) add(consumed, f.item, f.rate);
    if (outside && r.route?.fluid)
      for (const f of inputs) if (f.item === r.route.fluid) add(minerDraw, f.item, f.rate);
    if (r.node) add(nodeUse, r.node, n);
    if (r.extracts) add(extracted, r.extracts.item, r.extracts.rate * n);
    const power = r.powerMW * (r.heater ? whole : n);
    if (power >= 0) consumptionMW += power;
    else generationMW -= power;
    usage.push({
      id: r.id,
      name: r.name,
      machine: r.machine,
      machines: r.heater ? whole : n,
      machinesCeil: whole,
      powerMW: power,
      ...(r.heater ? { boilerLoad: whole > 0 ? Math.min(1, n / whole) : 0 } : {}),
      inputs,
      outputs,
      ...(r.node ? { node: r.node } : {}),
    });
  }

  const target = new Map<string, number>();
  for (const t of request.targets) add(target, t.item, t.rate);
  const linkDemand = new Map<string, number>();
  for (const d of request.demand ?? []) add(linkDemand, d.item, d.rate);
  const caps = new Map<string, number>();
  for (const i of request.imports ?? []) add(caps, i.item, i.cap);

  const all = [
    ...new Set([...produced.keys(), ...consumed.keys(), ...target.keys(), ...linkDemand.keys()]),
  ].sort();
  const items: ItemFlow[] = [];
  const imports: ItemRate[] = [];
  const surplus: ItemRate[] = [];
  const missing: ItemRate[] = [];
  const minerSupply: ItemRate[] = [];
  const targets: ItemRate[] = [];
  const forLinks = new Map<string, number>();
  for (const item of all) {
    const p = produced.get(item) ?? 0;
    const c = consumed.get(item) ?? 0;
    const net = p - c;
    const imported = net < -EPS ? -net : 0;
    let left = Math.max(0, net);
    const t = Math.min(left, target.get(item) ?? 0);
    left -= t;
    const l = Math.min(left, linkDemand.get(item) ?? 0);
    left -= l;
    if (imported > 0) {
      imports.push({ item, rate: imported });
      const supplied = Math.min(imported, minerDraw.get(item) ?? 0);
      if (supplied > EPS) minerSupply.push({ item, rate: supplied });
      const short = imported - supplied - (caps.get(item) ?? 0);
      if (short > EPS) missing.push({ item, rate: short });
    }
    if (left > EPS) surplus.push({ item, rate: left });
    if (target.has(item)) targets.push({ item, rate: t });
    if (linkDemand.has(item)) forLinks.set(item, l);
    items.push({
      item,
      produced: p,
      consumed: c,
      imported,
      surplus: left > EPS ? left : 0,
      demand: t + l,
    });
  }

  const nodes: NodeUsage[] = [...nodeUse]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([node, used]) => ({ node, used, budget: used, nne: used * (nne.get(node) ?? 0) }));
  const extraction: ResourceExtraction[] = [...extracted]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([item, rate]) => ({ item, rate }));
  const stack = objectiveStack(request);
  return {
    result: {
      status: 'ok',
      objective: stack[0]!,
      objectives: stack,
      stages: [],
      recipes: usage.sort((a, b) => (a.id < b.id ? -1 : 1)),
      items: items.filter((i) => i.produced || i.consumed || i.imported || i.surplus || i.demand),
      imports,
      surplus,
      nodes,
      extraction,
      power: { consumptionMW, generationMW, netMW: consumptionMW - generationMW },
      diagnostics: [],
      stats: { recipes: usage.length, columns: 0, rows: 0 },
      ...(minerSupply.length ? { minerSupply } : {}),
    },
    missing,
    targets,
    forLinks,
  };
}
