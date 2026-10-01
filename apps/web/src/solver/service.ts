/**
 * What the solver worker does, without the worker plumbing, so it runs in
 * Node tests with the same model and backend types.
 */
import { MW_ITEM_ID, type Model } from '@sps/data';
import { factoryGraph, type FactoryGraph, type GraphLabels } from '@sps/graph';
import { compareTiers, solve, summarizePlan, type LpBackend, type PlanSummary } from '@sps/solver';
import { factorySolveRequest, type World } from '@sps/world';
import type { Catalog, CatalogItem } from './protocol';

/** A solved factory: the table summary and the flowchart (M7), both built in the worker. */
export interface SolvedFactory {
  plan: PlanSummary;
  graph: FactoryGraph;
}

export interface SolverService {
  dataHash: string;
  catalog: Catalog;
  solve(world: World, factoryId: string): Promise<SolvedFactory>;
}

export function createSolverService(model: Model, backend: LpBackend): SolverService {
  const labels = modelLabels(model);
  return {
    dataHash: model.meta.dataHash,
    catalog: modelCatalog(model),
    async solve(world, factoryId) {
      const request = factorySolveRequest(world, model, factoryId);
      const result = await solve(model, request, backend);
      return { plan: summarizePlan(model, result), graph: factoryGraph(result, labels) };
    },
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
    tiers,
  };
}
