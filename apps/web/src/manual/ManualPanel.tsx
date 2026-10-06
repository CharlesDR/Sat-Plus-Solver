/**
 * Manual mode (A36): the Solver | Manual switch, and while manual, the edit
 * bar (Undo, Revert all, Discard manual plan), the selected recipe group's
 * machine count, and the recipe palette to add a group.
 */
import type { FlowNode } from '@sps/graph';
import type { Factory } from '@sps/world';
import { manualEntries } from '@sps/world';
import { useMemo, useState } from 'react';
import type { CatalogRecipe } from '../solver/protocol';
import { paletteMatches } from './manual';

/** The two-state switch at the top of the factory view. */
export function ModeSwitch(props: {
  manual: boolean;
  /** Why Manual can't be picked yet (the plan is still solving). */
  blocked?: string | undefined;
  onChange(manual: boolean): void;
}) {
  const { manual, blocked } = props;
  return (
    <div className={manual ? 'mode-bar manual' : 'mode-bar'}>
      <div className="mode-switch" role="radiogroup" aria-label="Plan mode">
        <button
          type="button"
          role="radio"
          aria-checked={!manual}
          onClick={() => manual && props.onChange(false)}
        >
          Solver
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={manual}
          disabled={!manual && !!blocked}
          title={!manual ? blocked : undefined}
          onClick={() => !manual && props.onChange(true)}
        >
          Manual
        </button>
      </div>
      <p className="mode-note" role="status">
        {manual
          ? 'Manual: the solver is paused for this factory. Flows are plain arithmetic on your machine counts and are not solver-checked.'
          : 'Solver: the plan is solved from your targets and settings. Switch to Manual to freeze it and edit it by hand.'}
      </p>
    </div>
  );
}

export function ManualPanel(props: {
  factory: Factory;
  recipes: readonly CatalogRecipe[];
  /** The selected flowchart node, if any. */
  node: FlowNode | undefined;
  /** Missing inputs, for the summary line. */
  missing: number;
  onCount(recipe: string, machines: number): void;
  /** A recipe added from the palette, at one machine. */
  onAdd(recipe: string): void;
  onUndo(): void;
  onRevert(): void;
  onDiscard(): void;
}) {
  const { factory, recipes, node, missing } = props;
  const manual = factory.manual!;
  const edits = manual.edits.length;
  const [confirm, setConfirm] = useState(false);
  const [search, setSearch] = useState('');
  const groups = useMemo(() => new Set(manualEntries(manual).map((e) => e.recipe)), [manual]);
  const matches = useMemo(() => paletteMatches(recipes, search), [recipes, search]);
  const target =
    node?.recipe && (node.kind === 'recipe' || node.kind === 'resource') ? node : undefined;

  return (
    <section className="manual-panel" aria-label="Manual plan">
      <div className="tweak-bar">
        <strong>Manual edits ({edits})</strong>
        <button
          type="button"
          onClick={props.onUndo}
          disabled={!edits}
          title="Undo the last edit (Ctrl+Z)"
        >
          Undo
        </button>
        <button type="button" onClick={props.onRevert} disabled={!edits}>
          Revert all
        </button>
        {confirm ? (
          <>
            <span>Throw the manual plan away and go back to the solver?</span>
            <button type="button" className="danger" onClick={props.onDiscard}>
              Discard
            </button>
            <button type="button" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirm(true)}>
            Discard manual plan…
          </button>
        )}
        {missing > 0 && (
          <span className="warning">
            {missing} input{missing === 1 ? '' : 's'} missing
          </span>
        )}
      </div>
      {target && (
        <CountEditor
          key={`${target.recipe}:${target.machines}:${target.boilerLoad}`}
          node={target}
          onCount={(m) => props.onCount(target.recipe!, m)}
        />
      )}
      <div className="palette">
        <label>
          Add a recipe{' '}
          <input
            type="search"
            value={search}
            placeholder="Search recipes or products"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {search.trim() && (
          <ul className="swap-list" aria-label="Recipes to add">
            {matches.map((r) => (
              <li key={r.id}>
                <button type="button" disabled={groups.has(r.id)} onClick={() => props.onAdd(r.id)}>
                  {groups.has(r.id) ? 'In the plan' : 'Add'} {r.name}
                </button>
                <span className="meta">
                  {r.machine} · makes {r.products.join(', ') || 'nothing'}
                  {r.alternate && <span className="badge">alternate</span>}
                </span>
              </li>
            ))}
            {!matches.length && <li className="hint">No recipe matches.</li>}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The selected group's machine count: fractional, 0 removes it. Commits on Enter or blur. */
function CountEditor(props: { node: FlowNode; onCount(machines: number): void }) {
  const { node } = props;
  // A heater's count is its boiler throughput (A17), as the plan stores it.
  const now = (node.machines ?? 0) * (node.boilerLoad ?? 1);
  const [text, setText] = useState(String(Math.round(now * 10000) / 10000));
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= 0 && Math.abs(v - now) > 1e-9) props.onCount(v);
  };
  return (
    <div className="node-actions" role="group" aria-label={`Edit ${node.label}`}>
      <span className="node-name">{node.label}</span>
      <label>
        Machines{' '}
        <input
          type="number"
          min={0}
          step="any"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </label>
      <span className="meta">{node.machine}</span>
      <button type="button" onClick={() => props.onCount(0)}>
        Remove from plan
      </button>
    </div>
  );
}
