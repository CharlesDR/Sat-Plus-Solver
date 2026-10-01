import loadHighs from 'highs';
import { toLpText } from './lpFormat';
import type { LpBackend, LpModel, LpOptions, LpSolution, LpStatus } from './types';

type Highs = Awaited<ReturnType<typeof loadHighs>>;
type HighsLoaderOptions = Parameters<typeof loadHighs>[0];

const STATUS: Record<string, LpStatus> = {
  Optimal: 'optimal',
  Infeasible: 'infeasible',
  Unbounded: 'unbounded',
  'Primal infeasible or unbounded': 'infeasible-or-unbounded',
  'Time limit reached': 'time-limit',
  'Iteration limit reached': 'iteration-limit',
};

/**
 * HiGHS (WASM) implementation of LpBackend. The WASM module is loaded lazily
 * on first solve and reloaded if a solve throws (a crashed instance is not reused).
 * `loaderOptions` lets the browser build pass `locateFile` for the .wasm asset.
 */
export function createHighsBackend(loaderOptions?: HighsLoaderOptions): LpBackend {
  let instance: Promise<Highs> | undefined;
  const highs = () => (instance ??= loadHighs(loaderOptions));

  return {
    async solve(model: LpModel, options: LpOptions = {}): Promise<LpSolution> {
      const { text, columns, rows } = toLpText(model);
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
        try {
          return solveMip(h, text, columns, settings, model, start);
        } catch (e) {
          instance = undefined;
          return { status: 'error', rawStatus: `HiGHS threw: ${(e as Error).message}` };
        }
      }
      let result: ReturnType<Highs['solve']>;
      try {
        result = h.solve(text, settings);
      } catch (e) {
        instance = undefined;
        return { status: 'error', rawStatus: `HiGHS threw: ${(e as Error).message}` };
      }
      const rawStatus = String(result.Status);
      if (rawStatus === 'Empty') {
        // No rows/columns to optimize: every variable sits at its lower bound (0 by default).
        return {
          status: 'optimal',
          rawStatus,
          objective: 0,
          values: new Map(model.variables.map((v) => [v.name, 0])),
        };
      }
      const status = STATUS[rawStatus] ?? 'error';
      const hasSolution =
        status === 'optimal' || status === 'time-limit' || status === 'iteration-limit';
      if (!hasSolution) return { status, rawStatus };

      const values = new Map<string, number>();
      for (const [col, name] of columns) {
        const c = (result.Columns as Record<string, { Primal?: number } | undefined>)[col];
        values.set(name, c?.Primal ?? 0);
      }
      const duals = new Map<string, number>();
      for (const r of result.Rows as { Name?: string; Dual?: number }[]) {
        const name = r.Name !== undefined ? rows.get(r.Name) : undefined;
        if (name !== undefined && r.Dual !== undefined)
          duals.set(name, (duals.get(name) ?? 0) + r.Dual);
      }
      return { status, rawStatus, objective: result.ObjectiveValue, values, duals };
    },
  };
}

/** HiGHS model status codes (`constants.modelStatus`) the MILP path maps. */
const MIP_STATUS: Record<number, [LpStatus, string]> = {
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
  text: string,
  columns: Map<string, string>,
  settings: Record<string, number | boolean>,
  model: LpModel,
  start: ReadonlyMap<string, number> | undefined,
): LpSolution {
  return h.withModel({ format: 'lp', data: text }, (m) => {
    m.options.set(settings);
    if (start) {
      const n = m.getDimensions().numCols;
      const colValue = new Float64Array(n);
      for (let i = 0; i < n; i++) colValue[i] = start.get(columns.get(m.getColName(i)) ?? '') ?? 0;
      m.setSolution({ colValue });
    }
    m.run();
    const code = Number(m.getModelStatus());
    const [status, rawStatus] = MIP_STATUS[code] ?? ['error', `HiGHS model status ${code}`];
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
    for (let i = 0; i < colValue.length; i++) {
      const name = columns.get(m.getColName(i));
      if (name !== undefined) values.set(name, colValue[i]!);
    }
    for (const v of model.variables) if (!values.has(v.name)) values.set(v.name, 0);
    const gap = status === 'optimal' ? 0 : Number(m.info.get('mip_gap'));
    return { status, rawStatus, objective: m.getObjectiveValue(), values, gap };
  });
}
