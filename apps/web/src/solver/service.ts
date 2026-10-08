/**
 * What the solver worker does, without the worker plumbing, so it runs in
 * Node tests with the same model and backend types.
 */
import { MW_ITEM_ID, type Model } from '@sps/data';
import {
  factoryGraph,
  layoutFactoryGraph,
  type GraphLabels,
  type LayoutEngine,
  type SubFactoryFlow,
} from '@sps/graph';
import {
  bestNodeRates,
  compareTiers,
  rawResources,
  sizeNetwork,
  solve,
  summarizePlan,
  type LpBackend,
} from '@sps/solver';
import {
  addTweak,
  createSolveCache,
  DEFAULT_PIPE_CAPACITIES,
  importModeler,
  manualEntries,
  markAllBuilt,
  modelerNetwork,
  parseModeler,
  resolveWorld,
  writeModeler,
  sizePowerPlant,
  type FactoryResult,
  type ResolveOptions,
  type SolveFactory,
  type World,
  type WorldResult,
} from '@sps/world';
import { modelerSheet } from './modeler';
import type {
  Catalog,
  CatalogItem,
  CatalogResource,
  FocusPlan,
  ModelerImported,
  SolveProgress,
  SwapPreview,
  WorldSolved,
  WorldSolveRequest,
  WorldSummary,
} from './protocol';

export interface SolverService {
  dataHash: string;
  catalog: Catalog;
  /**
   * Resolves the whole world (§4.3), memoizing factory solves across calls,
   * and returns its summary plus the focused factory's plan and flowchart.
   * `onProgress` hears each factory as it starts.
   */
  solve(request: WorldSolveRequest, onProgress?: (p: SolveProgress) => void): Promise<WorldSolved>;
}

/** Memoized factory solves kept between world solves; the oldest go first. */
export const CACHE_LIMIT = 500;

/**
 * `layout` lays out flowcharts for the Modeler export (A58); the worker
 * passes its own ELK, so the main thread never runs it.
 */
export function createSolverService(
  model: Model,
  backend: LpBackend,
  layout?: LayoutEngine,
): SolverService {
  const labels = modelLabels(model);
  const cache = createSolveCache();
  const solveFactory: SolveFactory = (r) => solve(model, r, backend);
  return {
    dataHash: model.meta.dataHash,
    catalog: modelCatalog(model),
    async solve({ world, focus, action }, onProgress) {
      const names = new Map(world.factories.map((f) => [f.id, f.name]));
      const options: ResolveOptions = onProgress
        ? { onProgress: (p) => onProgress({ ...p, factory: names.get(p.factory) ?? p.factory }) }
        : {};
      let result: WorldResult;
      let edited: World | undefined;
      let previews: SwapPreview[] | undefined;
      let imported: ModelerImported | undefined;
      let sfmd: string | undefined;
      if (action?.kind === 'import-modeler') {
        // A57: parse (a malformed file throws, so the world is left as it was), size, import, mark as built.
        const save = parseModeler(action.text);
        const sizing = await sizeNetwork(modelerNetwork(save, model), backend);
        if (sizing.status !== 'ok')
          throw new Error(`The Modeler save could not be sized (${sizing.status}).`);
        const made = importModeler(world, save, model, { sizing });
        result = await resolveWorld(made.world, model, solveFactory, cache, options);
        const ids = new Set(made.factories);
        edited = markAllBuilt(
          made.world,
          result.factories.filter((f) => ids.has(f.id)),
          model.meta.dataHash,
          action.at,
        ).world;
        imported = { factories: made.factories, report: made.report, inferred: made.inferred };
      } else if (action?.kind === 'size-power') {
        const sized = await sizePowerPlant(
          world,
          model,
          solveFactory,
          action.factoryId,
          cache,
          options,
        );
        result = sized.result;
        edited = sized.world;
      } else result = await resolveWorld(world, model, solveFactory, cache, options);
      if (action?.kind === 'preview-swaps') {
        previews = [];
        for (const to of action.candidates) {
          const swapped = addTweak(world, action.factoryId, {
            kind: 'swap',
            from: action.from,
            to,
          });
          const r = await resolveWorld(swapped, model, solveFactory, cache);
          const f = r.factories.find((x) => x.id === action.factoryId);
          if (!f) throw new Error(`Unknown factory "${action.factoryId}".`);
          previews.push({
            recipe: to,
            status: f.status,
            machines: f.machines,
            consumptionMW: f.power.consumptionMW,
            extraction: f.extraction.map((e) => ({ item: e.item, rate: e.rate })),
          });
        }
      }
      if (action?.kind === 'export-modeler') {
        if (!layout) throw new Error('Modeler export needs a layout engine.');
        const nested = action.factoryId === undefined;
        const chosen = nested
          ? result.factories
          : result.factories.filter((f) => f.id === action.factoryId);
        if (chosen.length === 0) throw new Error(`Unknown factory "${action.factoryId}".`);
        const sheets = [];
        for (const f of chosen) {
          const graph = focusPlan(model, labels, f, result).graph;
          // A manual plan's own counts (A36); its result rounds a heater's to whole heaters.
          const manual = world.factories.find((x) => x.id === f.id)?.manual;
          const entries = manual?.enabled ? manualEntries(manual) : f.plan;
          const counts = new Map(entries.map((e) => [e.recipe, e.machines]));
          const placed = await layoutFactoryGraph(graph, layout);
          sheets.push(modelerSheet(f.id, graph, placed, nested, counts));
        }
        sfmd = writeModeler(world, sheets, model);
      }
      for (const key of cache.keys()) {
        if (cache.size <= CACHE_LIMIT) break;
        cache.delete(key);
      }
      const f = focus !== undefined ? result.factories.find((x) => x.id === focus) : undefined;
      const plan: FocusPlan | undefined = f && focusPlan(model, labels, f, result);
      return {
        world: summarizeWorld(result),
        ...(plan ? { focus: plan } : {}),
        ...(edited ? { edited } : {}),
        ...(previews ? { previews } : {}),
        ...(imported ? { imported } : {}),
        ...(sfmd !== undefined ? { sfmd } : {}),
      };
    },
  };
}

/**
 * The focused factory's plan and flowchart. A manual plan's missing inputs
 * (A36) are listed apart from its imports, as the flowchart draws them. Its
 * sub-factories (A53) are boxes, with what flows between them and it in
 * `world`.
 */
export function focusPlan(
  model: Model,
  labels: GraphLabels,
  f: FactoryResult,
  world?: Pick<WorldResult, 'factories' | 'links'>,
): FocusPlan {
  const plan = summarizePlan(model, f.result);
  const flows = (from: string, to: string) =>
    (world?.links ?? [])
      .filter((l) => l.from === from && l.to === to && l.delivered > 0)
      .map((l) => ({ item: l.item, rate: l.delivered }));
  const children: SubFactoryFlow[] = (f.children ?? []).map((id) => ({
    id,
    name: world?.factories.find((x) => x.id === id)?.name ?? id,
    inputs: flows(f.id, id),
    outputs: flows(id, f.id),
  }));
  const graph = factoryGraph(f.result, labels, f.manual?.missing, children);
  if (!f.manual) return { factoryId: f.id, plan, graph };
  const lacking = new Map(f.manual.missing.map((m) => [m.item, m.rate]));
  const name = new Map(plan.imports.map((i) => [i.item, i.name]));
  return {
    factoryId: f.id,
    plan: {
      ...plan,
      imports: plan.imports
        .map((i) => ({ ...i, rate: i.rate - (lacking.get(i.item) ?? 0) }))
        .filter((i) => i.rate > 1e-9 * Math.max(1, i.rate + (lacking.get(i.item) ?? 0))),
    },
    graph,
    manual: {
      missing: f.manual.missing.map((m) => ({
        item: m.item,
        name: name.get(m.item) ?? m.item,
        rate: m.rate,
      })),
    },
  };
}

/** The world result without each factory's full solve result (it stays in the worker). */
export function summarizeWorld(result: WorldResult): WorldSummary {
  return {
    ...result,
    factories: result.factories.map((f) => {
      const { result: solved, ...rest } = f;
      return {
        ...rest,
        diagnostics: [...solved.diagnostics],
      };
    }),
  };
}

/** Item and machine display names for the flowchart. */
export function modelLabels(model: Model): GraphLabels {
  const item = new Map(model.items.map((i) => [i.id, i.name]));
  const machine = new Map(model.machines.map((m) => [m.id, m.name]));
  return { item: (id) => item.get(id), machine: (id) => machine.get(id) };
}

const byName =
  <T extends { id: string }>(name: (x: T) => string) =>
  (a: T, b: T) =>
    name(a).localeCompare(name(b), 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Items a target can name: every recipe output except power (MW). */
export function targetCatalog(model: Model): CatalogItem[] {
  const produced = new Set(model.recipes.flatMap((r) => r.outputs.map((o) => o.item)));
  return model.items
    .filter((i) => produced.has(i.id) && i.id !== MW_ITEM_ID)
    .map((i) => ({ id: i.id, name: i.name }))
    .sort(byName((c) => c.name));
}

/** Raw resources for the resource-limits editor (A33). */
export function resourceCatalog(model: Model): CatalogResource[] {
  const item = new Map(model.items.map((i) => [i.id, i]));
  const best = bestNodeRates(model);
  return rawResources(model)
    .map((r) => ({
      id: r.item,
      name: item.get(r.item)?.name ?? r.item,
      fluid: item.get(r.item)?.form === 'fluid',
      limited: r.limited,
      ...(r.limited
        ? {
            nodes: model.nodes
              .filter((n) => n.resource === r.item)
              .map((n) => ({ id: n.id, count: n.count, rate: best.get(n.id) ?? 0 })),
          }
        : {}),
    }))
    .sort(byName((r) => r.name));
}

export function modelCatalog(model: Model): Catalog {
  const item = new Map(model.items.map((i) => [i.id, i.name]));
  const machine = new Map(model.machines.map((m) => [m.id, m.name]));
  const name = (id: string) => item.get(id) ?? id;
  const tiers = [...new Set(model.recipes.map((r) => r.tier))]
    .filter((t) => /^\d+-\d+$/.test(t) && t !== '0-0')
    .sort(compareTiers);
  return {
    targets: targetCatalog(model),
    items: model.items
      .filter((i) => i.id !== MW_ITEM_ID)
      .map((i) => ({ id: i.id, name: i.name }))
      .sort(byName((c) => c.name)),
    recipes: model.recipes
      .map((r) => ({
        id: r.id,
        name: r.name,
        machine: machine.get(r.machine) ?? r.machine,
        alternate: r.alternate,
        tier: r.tier,
        products: r.outputs.filter((o) => o.item !== MW_ITEM_ID).map((o) => name(o.item)),
        outputs: r.outputs.filter((o) => o.item !== MW_ITEM_ID).map((o) => o.item),
      }))
      .sort(byName((r) => r.name)),
    nodes: model.nodes
      .map((n) => ({
        id: n.id,
        label: `${name(n.resource)} (${n.purity})`,
        purity: n.purity,
        count: n.count,
      }))
      .sort(byName((n) => n.label)),
    resources: resourceCatalog(model),
    tiers,
    fluids: model.items
      .filter((i) => i.form === 'fluid')
      .map((i) => i.id)
      .sort(),
    belts: model.beltCapacities.map((b) => ({ ...b })),
    pipes: Object.entries(DEFAULT_PIPE_CAPACITIES).map(([tier, perMin]) => ({
      tier: Number(tier),
      perMin,
    })),
  };
}
