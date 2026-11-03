import type { LpOptions } from '../lp/types';
import type { Solver } from './solve';
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
  solver: Solver,
  request: SolveRequest,
  options: LpOptions = {},
): Promise<AlternatesReport> {
  const as = (alternates: boolean): SolveRequest => ({
    ...request,
    recipes: { ...request.recipes, alternates },
  });
  const without = await solver.solve(as(false), options);
  const withAlt = await solver.solve(as(true), options);
  const alternate = new Set(solver.model.recipes.filter((r) => r.alternate).map((r) => r.id));
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
