/**
 * The build mark bar in the factory view (A44): Mark as built, or the
 * mark's state with its flags, Re-mark as built, Restore build and Clear mark.
 */
import type { BuildCheck, Factory } from '@sps/world';
import type { Names } from '../diagnostics';
import { StatusChip } from '../ui/StatusChip';
import { BUILD_STATE, causesText, flagView, markedText } from './build';

export function BuildPanel(props: {
  factory: Factory;
  check: BuildCheck | undefined;
  names: Pick<Names, 'item' | 'recipe'>;
  /** Why marking is not possible right now (still solving, or no plan). */
  blocked?: string | undefined;
  onMark(): void;
  onClear(): void;
  onRestore(): void;
}) {
  const { factory, check, names, blocked } = props;
  if (!factory.built)
    return (
      <div className="build-bar">
        <button type="button" disabled={!!blocked} title={blocked} onClick={props.onMark}>
          Mark as built
        </button>
        <span className="hint">
          Saves this plan as the one built in your game, and flags any drift from it.
        </span>
      </div>
    );
  const state = check && BUILD_STATE[check.state];
  const causes = check && check.flags.length ? causesText(check.causes) : undefined;
  return (
    <div className={`build-bar ${check?.state ?? ''}`} data-testid="build-bar">
      <div className="build-head">
        {state ? (
          <span className={`status-chip ${state.tone}`}>{state.label}</span>
        ) : (
          <StatusChip status="neutral" label="Marked as built" />
        )}
        <span className="hint">Marked {markedText(factory.built.markedAt)}</span>
        <span className="build-actions">
          <button
            type="button"
            disabled={!!blocked}
            title={blocked ?? 'Save the current plan as the build'}
            onClick={props.onMark}
          >
            Re-mark as built
          </button>
          <button
            type="button"
            title="Switch to manual mode with the plan as built"
            onClick={props.onRestore}
          >
            Restore build
          </button>
          <button type="button" className="link-button" onClick={props.onClear}>
            Clear mark
          </button>
        </span>
      </div>
      {check && check.flags.length > 0 && (
        <ul className="build-flags" aria-label="Build flags">
          {check.flags.map((f) => {
            const v = flagView(f, names);
            return (
              <li key={v.kind} className={v.severity}>
                <strong>{v.title}</strong>
                <ul>
                  {v.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      {causes && <p className="hint">{causes}</p>}
    </div>
  );
}
