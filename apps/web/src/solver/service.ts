/**
 * What the solver worker does, without the worker plumbing, so it runs in
 * Node tests with the same model and backend types.
 */
import { MW_ITEM_ID, type Model } from '@sps/data';
import { solve, summarizePlan, type LpBackend, type PlanSummary } from '@sps/solver';
import { factorySolveRequest, type World } from '@sps/world';
import type { CatalogItem } from './protocol';

export interface SolverService {
  dataHash: string;
  /** Items a target can name: every recipe output except power (MW targets arrive in M4). */
  catalog: CatalogItem[];
  solve(world: World, factoryId: string): Promise<PlanSummary>;
}

export function createSolverService(model: Model, backend: LpBackend): SolverService {
  return {
    dataHash: model.meta.dataHash,
    catalog: targetCatalog(model),
    async solve(world, factoryId) {
      const request = factorySolveRequest(world, model, factoryId);
      return summarizePlan(model, await solve(model, request, backend));
    },
  };
}

export function targetCatalog(model: Model): CatalogItem[] {
  const produced = new Set(model.recipes.flatMap((r) => r.outputs.map((o) => o.item)));
  return model.items
    .filter((i) => produced.has(i.id) && i.id !== MW_ITEM_ID)
    .map((i) => ({ id: i.id, name: i.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
