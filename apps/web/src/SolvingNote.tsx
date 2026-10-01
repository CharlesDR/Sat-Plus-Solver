import { progressLabel } from './diagnostics';
import type { SolveProgress } from './solver/protocol';

/** "Solving Smelter (2 of 5)…" with a progress bar once the worker reports (M10). */
export function SolvingNote({
  progress,
  what,
}: {
  progress?: SolveProgress | undefined;
  what: string;
}) {
  return (
    <p className="solving" role="status">
      <span>{progressLabel(progress, what)}</span>
      {progress && (
        <progress
          aria-label="Solve progress"
          max={progress.factories}
          value={Math.min(progress.step, progress.factories)}
        />
      )}
    </p>
  );
}
