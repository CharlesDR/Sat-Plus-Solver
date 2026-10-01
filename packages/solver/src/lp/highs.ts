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
      let result: ReturnType<Highs['solve']>;
      try {
        result = h.solve(text, {
          output_flag: false,
          // The solver's checks require every variable ≥ −1e-9 (CLAUDE.md), so
          // HiGHS must not leave bound violations up to its 1e-7 default.
          primal_feasibility_tolerance: 1e-10,
          ...(options.timeLimitSeconds !== undefined
            ? { time_limit: options.timeLimitSeconds }
            : {}),
        });
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
