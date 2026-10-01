import { OBJECTIVE_IDS, type ObjectiveId } from '@sps/solver';
import { useId } from 'react';

export const OBJECTIVE_LABELS: Record<ObjectiveId, string> = {
  resources: 'Raw resources (O1)',
  scarcity: 'Scarcity-weighted resources (O2)',
  machines: 'Machines (O3)',
  power: 'Power draw (O4)',
  output: 'Maximize output (O5)',
  resourceTypes: 'Resource types (O6)',
};

/** Stack rules the solver enforces, applied before an edit is made. */
export function canAdd(stack: readonly ObjectiveId[], o: ObjectiveId): boolean {
  return !stack.includes(o);
}

/** Adds an objective at the bottom, or on top for `output` (it may only come first). */
export function addObjective(stack: readonly ObjectiveId[], o: ObjectiveId): ObjectiveId[] {
  if (!canAdd(stack, o)) return [...stack];
  return o === 'output' ? [o, ...stack] : [...stack, o];
}

/** Moves the objective at `k` by `by` places; `output` stays first. */
export function moveObjective(stack: readonly ObjectiveId[], k: number, by: -1 | 1): ObjectiveId[] {
  const j = k + by;
  const out = [...stack];
  if (j < 0 || j >= out.length) return out;
  if (out[k] === 'output' || out[j] === 'output') return out;
  [out[k], out[j]] = [out[j]!, out[k]!];
  return out;
}

interface Props {
  stack: readonly ObjectiveId[];
  onChange(stack: ObjectiveId[]): void;
}

/** The lexicographic objective stack: highest priority first, no repeats, `output` only first. */
export function ObjectiveStack({ stack, onChange }: Props) {
  const addId = useId();
  const left = OBJECTIVE_IDS.filter((o) => canAdd(stack, o));
  return (
    <div className="objectives">
      <ol aria-label="Objective stack">
        {stack.map((o, k) => (
          <li key={o}>
            <span>{OBJECTIVE_LABELS[o]}</span>
            <button
              type="button"
              aria-label={`Move ${OBJECTIVE_LABELS[o]} up`}
              disabled={moveObjective(stack, k, -1).join() === stack.join()}
              onClick={() => onChange(moveObjective(stack, k, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${OBJECTIVE_LABELS[o]} down`}
              disabled={moveObjective(stack, k, 1).join() === stack.join()}
              onClick={() => onChange(moveObjective(stack, k, 1))}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove ${OBJECTIVE_LABELS[o]}`}
              disabled={stack.length === 1}
              onClick={() => onChange(stack.filter((x) => x !== o))}
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
      {left.length > 0 && (
        <label htmlFor={addId}>
          Add objective{' '}
          <select
            id={addId}
            value=""
            onChange={(e) => {
              if (e.target.value) onChange(addObjective(stack, e.target.value as ObjectiveId));
            }}
          >
            <option value="">Choose…</option>
            {left.map((o) => (
              <option key={o} value={o}>
                {OBJECTIVE_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
