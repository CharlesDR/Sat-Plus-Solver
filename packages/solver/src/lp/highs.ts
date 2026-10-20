import loadHighs from 'highs';
import { type LpArrays, toLpArrays } from './lpFormat';
import type { LpBackend, LpModel, LpOptions, LpSolution, LpStatus } from './types';

type Highs = Awaited<ReturnType<typeof loadHighs>>;
type HighsLoaderOptions = Parameters<typeof loadHighs>[0];

/**
 * HiGHS (WASM) implementation of LpBackend. The WASM module is loaded lazily
 * on first solve and reloaded if a solve throws (a crashed instance is not reused).
 * `loaderOptions` lets the browser build pass `locateFile` for the .wasm asset.
 * Models go in as arrays (`toLpArrays`), not LP text: parsing the text was
 * most of a solve's time (T1).
 */
export function createHighsBackend(loaderOptions?: HighsLoaderOptions): LpBackend {
  let instance: Promise<Highs> | undefined;
  const highs = () => (instance ??= loadHighs(loaderOptions));

  return {
    async solve(model: LpModel, options: LpOptions = {}): Promise<LpSolution> {
      const arrays = toLpArrays(model);
      const h = await highs();
      const { start } = options;
      const settings = {
        output_flag: false,
        // The solver's checks require every variable ≥ −1e-9 (CLAUDE.md), so
        // HiGHS must not leave bound violations up to its 1e-7 default.
        primal_feasibility_tolerance: 1e-10,
        ...(options.mipFeasibilityTolerance !== undefined
          ? { mip_feasibility_tolerance: options.mipFeasibilityTolerance }
          : {}),
        ...(options.timeLimitSeconds !== undefined ? { time_limit: options.timeLimitSeconds } : {}),
      };
      if (model.variables.some((v) => v.integer)) {
        // HiGHS can fail on a MILP with tiny right-hand sides (a 1e-6/min
        // demand): wrongly declare it infeasible or unbounded, in presolve or
        // at its 1e-6 MIP tolerance, or throw. Confirm without presolve, then
        // at a tight tolerance, before reporting it.
        const attempts = [{}, { presolve: 'off' }, { mip_feasibility_tolerance: 1e-10 }];
        let r: LpSolution = { status: 'error', rawStatus: 'not run' };
        for (const retry of attempts) {
          try {
            r = solveMip(await highs(), arrays, { ...settings, ...retry }, model, start);
          } catch (e) {
            instance = undefined;
            r = { status: 'error', rawStatus: `HiGHS threw: ${(e as Error).message}` };
          }
          if (!['infeasible', 'infeasible-or-unbounded', 'unbounded', 'error'].includes(r.status))
            return r;
        }
        return r;
      }
      try {
        let r = solveLp(h, arrays, settings, model);
        // Presolve's postsolve can leave a column just outside its bounds
        // (−1.5e-9 on a 0 lower bound), past the solver's own 1e-9 check.
        // Solve it again without presolve before handing it on.
        if (r.rawStatus === 'Optimal' && outOfBounds(r, arrays))
          r = solveLp(h, arrays, { ...settings, presolve: 'off' }, model);
        return r;
      } catch (e) {
        instance = undefined;
        return { status: 'error', rawStatus: `HiGHS threw: ${(e as Error).message}` };
      }
    },
  };
}

/** How far outside its bounds a column may come back before the LP is re-solved without presolve. */
const BOUND_SLACK = 1e-9;

/** Whether an optimal LP result has a column below its lower or above its upper bound. */
function outOfBounds(r: LpSolution, arrays: LpArrays): boolean {
  return arrays.columns.some((name, i) => {
    const x = r.values!.get(name) ?? 0;
    return x < arrays.colLower[i]! - BOUND_SLACK || x > arrays.colUpper[i]! + BOUND_SLACK;
  });
}

/** The model as HiGHS `passModel` data. */
function modelData(h: Highs, a: LpArrays) {
  return {
    numCols: a.numCols,
    numRows: a.numRows,
    sense:
      a.sense === 'min' ? h.constants.objectiveSense.minimize : h.constants.objectiveSense.maximize,
    colCost: a.colCost,
    colLower: a.colLower,
    colUpper: a.colUpper,
    rowLower: a.rowLower,
    rowUpper: a.rowUpper,
    matrix: {
      format: 'csr' as const,
      numRows: a.numRows,
      numCols: a.numCols,
      starts: a.starts,
      indices: a.indices,
      values: a.values,
    },
    integrality: a.integrality,
  };
}

/** One LP solve, with its values and its duals summed per constraint (a ranged row is two). */
function solveLp(
  h: Highs,
  arrays: LpArrays,
  settings: Record<string, number | boolean | string>,
  model: LpModel,
): LpSolution {
  return h.withModel(modelData(h, arrays), (m) => {
    m.options.set(settings);
    m.run();
    const code = Number(m.getModelStatus());
    const [status, rawStatus] = MODEL_STATUS[code] ?? ['error', `HiGHS model status ${code}`];
    if (rawStatus === 'Empty') {
      // No rows/columns to optimize: every variable sits at its lower bound (0 by default).
      return {
        status,
        rawStatus,
        objective: 0,
        values: new Map(model.variables.map((v) => [v.name, 0])),
      };
    }
    const hasSolution =
      status === 'optimal' || status === 'time-limit' || status === 'iteration-limit';
    if (!hasSolution) return { status, rawStatus };
    const { colValue, rowDual } = m.getSolution();
    const values = new Map<string, number>();
    arrays.columns.forEach((name, i) => values.set(name, colValue[i] ?? 0));
    const duals = new Map<string, number>();
    arrays.rows.forEach((name, i) => {
      const d = rowDual[i];
      if (d !== undefined) duals.set(name, (duals.get(name) ?? 0) + d);
    });
    return { status, rawStatus, objective: m.getObjectiveValue(), values, duals };
  });
}

/** HiGHS model status codes (`constants.modelStatus`) and the status text reported for each. */
const MODEL_STATUS: Record<number, [LpStatus, string]> = {
  6: ['optimal', 'Empty'],
  7: ['optimal', 'Optimal'],
  8: ['infeasible', 'Infeasible'],
  9: ['infeasible-or-unbounded', 'Primal infeasible or unbounded'],
  10: ['unbounded', 'Unbounded'],
  13: ['time-limit', 'Time limit reached'],
  14: ['iteration-limit', 'Iteration limit reached'],
};
/** `primal_solution_status` value for a feasible primal solution. */
const SOLUTION_FEASIBLE = 2;

/**
 * MILPs go through the persistent model API, the only one that exposes the
 * MIP gap: a time-limited solve returns its incumbent and that gap (§3.4).
 */
function solveMip(
  h: Highs,
  arrays: LpArrays,
  settings: Record<string, number | boolean | string>,
  model: LpModel,
  start: ReadonlyMap<string, number> | undefined,
): LpSolution {
  return h.withModel(modelData(h, arrays), (m) => {
    m.options.set(settings);
    if (start)
      m.setSolution({ colValue: Float64Array.from(arrays.columns, (c) => start.get(c) ?? 0) });
    m.run();
    const code = Number(m.getModelStatus());
    const [status, rawStatus] = MODEL_STATUS[code] ?? ['error', `HiGHS model status ${code}`];
    if (rawStatus === 'Empty') {
      return {
        status,
        rawStatus,
        objective: 0,
        gap: 0,
        values: new Map(model.variables.map((v) => [v.name, 0])),
      };
    }
    const hasSolution =
      (status === 'optimal' || status === 'time-limit' || status === 'iteration-limit') &&
      Number(m.info.get('primal_solution_status')) === SOLUTION_FEASIBLE;
    if (!hasSolution) return { status, rawStatus };
    const colValue = m.getSolution().colValue;
    const values = new Map<string, number>();
    arrays.columns.forEach((name, i) => values.set(name, colValue[i] ?? 0));
    const gap = status === 'optimal' ? 0 : Number(m.info.get('mip_gap'));
    return { status, rawStatus, objective: m.getObjectiveValue(), values, gap };
  });
}
