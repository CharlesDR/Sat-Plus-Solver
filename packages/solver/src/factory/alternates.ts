import type { Model } from '@sps/data';
import type { LpBackend, LpOptions } from '../lp/types';
import { solve } from './solve';
import type { ObjectiveId, SolveRequest, SolveResult } from './types';

export interface AlternatesReport {
  /** The plan with alternates off. */
  without: SolveResult;
  /** The plan with alternates on. */
  with: SolveResult;
  /** Alternate recipes the `with` plan uses, sorted by id: the ones worth enabling. */
  used: string[];
  /** Per stack objective: its value without and with alternates (when both plans solved). */
  stages: { objective: ObjectiveId; without: number; with: number }[];
}

/**
 * Which alternates would help this request: solves it with alternates off and
 * on (everything else unchanged) and lists the alternates the better plan uses.
 */
export async function compareAlternates(
  model: Model,
  request: SolveRequest,
  backend: LpBackend,
  options: LpOptions = {},
): Promise<AlternatesReport> {
  const as = (alternates: boolean): SolveRequest => ({
    ...request,
    recipes: { ...request.recipes, alternates },
  });
  const without = await solve(model, as(false), backend, options);
  const withAlt = await solve(model, as(true), backend, options);
  const alternate = new Set(model.recipes.filter((r) => r.alternate).map((r) => r.id));
  const used = withAlt.recipes.map((r) => r.id).filter((id) => alternate.has(id));
  const stages =
    without.status === 'ok' && withAlt.status === 'ok'
      ? without.stages.map((s, k) => ({
          objective: s.objective,
          without: s.value,
          with: withAlt.stages[k]!.value,
        }))
      : [];
  return { without, with: withAlt, used, stages };
}
