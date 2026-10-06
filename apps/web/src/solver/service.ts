/**
 * What the solver worker does, without the worker plumbing, so it runs in
 * Node tests with the same model and backend types.
 */
import { MW_ITEM_ID, type Model } from '@sps/data';
import { factoryGraph, type GraphLabels } from '@sps/graph';
import {
  bestNodeRates,
  compareTiers,
  rawResources,
  solve,
  summarizePlan,
  type LpBackend,
} from '@sps/solver';
import {
  addTweak,
  createSolveCache,
  DEFAULT_PIPE_CAPACITIES,
  resolveWorld,
  sizePowerPlant,
  type ResolveOptions,
  type SolveFactory,
  type World,
  type WorldResult,
} from '@sps/world';
import type {
  Catalog,
  CatalogItem,
  CatalogResource,
  FocusPlan,
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

export function createSolverService(model: Model, backend: LpBackend): SolverService {
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
      if (action?.kind === 'size-power') {
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
      for (const key of cache.keys()) {
        if (cache.size <= CACHE_LIMIT) break;
        cache.delete(key);
      }
      const f = focus !== undefined ? result.factories.find((x) => x.id === focus) : undefined;
      const plan: FocusPlan | undefined = f && {
        factoryId: f.id,
        plan: summarizePlan(model, f.result),
        graph: factoryGraph(f.result, labels),
      };
      return {
        world: summarizeWorld(result),
        ...(plan ? { focus: plan } : {}),
        ...(edited ? { edited } : {}),
        ...(previews ? { previews } : {}),
      };
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
