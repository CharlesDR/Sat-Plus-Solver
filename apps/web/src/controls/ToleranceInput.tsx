import { TOLERANCE_MAX, TOLERANCE_MIN, clampTolerance } from '@sps/world';
import { useState } from 'react';

/** A fraction as a percentage, without float noise (0.0001 → "0.01"). */
export const asPercent = (t: number) => String(Number((t * 100).toPrecision(10)));

/**
 * Lexicographic tolerance in percent. Out-of-range input clamps to 0.01%–90%
 * when it is committed (on blur or Enter); the solver itself rejects it.
 */
export function ToleranceInput({ value, onChange }: { value: number; onChange(t: number): void }) {
  const [draft, setDraft] = useState<string | undefined>();
  const commit = () => {
    if (draft === undefined) return;
    const n = Number(draft);
    setDraft(undefined);
    if (draft.trim() === '' || !Number.isFinite(n)) return;
    const t = clampTolerance(n / 100);
    if (t !== value) onChange(t);
  };
  return (
    <label>
      Tolerance (%)
      <input
        type="number"
        step="any"
        min={asPercent(TOLERANCE_MIN)}
        max={asPercent(TOLERANCE_MAX)}
        value={draft ?? asPercent(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </label>
  );
}
