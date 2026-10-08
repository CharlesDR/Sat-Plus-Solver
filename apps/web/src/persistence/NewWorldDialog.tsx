/**
 * File › New world (N1, N2, N8): name the new world, pick what it starts
 * from, and optionally save the current one to a slot first. Undo (a toast)
 * and "Restore previous world" bring the old world back.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { WorldStore } from '../store';
import { useToast, type ToastAction } from '../ui/toasts';
import { restorePrevious, startNewWorld, type StartFrom } from './newWorld';
import type { Saves } from './saves';

const STARTS: { value: StartFrom; label: string; hint: string }[] = [
  {
    value: 'settings',
    label: 'Keep my settings',
    hint: 'Objectives, alternates, recipe toggles, max tier and node pool edits; no factories.',
  },
  { value: 'empty', label: 'Empty', hint: 'One blank factory with the default settings.' },
  { value: 'sample', label: 'Sample world', hint: 'A small linked world to explore.' },
];

/** The "Started a new world" toast, with Undo when the old world was kept (N3). */
export function announceNewWorld(
  toast: (text: string, action?: ToastAction) => void,
  store: WorldStore,
  saves: Saves,
  undoable: boolean,
) {
  const named = store.getState().world.meta.name;
  const undo = () => toast(restorePrevious(store, saves) ?? 'Restored the previous world.');
  toast(
    named ? `Started “${named}”.` : 'Started a new world.',
    undoable ? { label: 'Undo', run: undo } : undefined,
  );
}

export function NewWorldDialog(props: { store: WorldStore; saves: Saves; onClose(): void }) {
  const { store, saves, onClose } = props;
  const current = useStore(store, (s) => s.world.meta.name);
  const [name, setName] = useState('');
  const [from, setFrom] = useState<StartFrom>('settings');
  const [saveFirst, setSaveFirst] = useState(false);
  const [saveAs, setSaveAs] = useState(current ?? '');
  const [error, setError] = useState<string>();
  const first = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => first.current?.focus(), []);

  const start = () => {
    const out = startNewWorld(store, saves, {
      from,
      name,
      ...(saveFirst ? { saveAs } : {}),
    });
    if (!out.ok) return setError(out.message);
    announceNewWorld(toast, store, saves, out.undoable);
    onClose();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <form
        className="palette-dialog new-world"
        role="dialog"
        aria-modal="true"
        aria-label="New world"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <h2>New world</h2>
        <label>
          Name
          <input
            ref={first}
            value={name}
            placeholder="Optional, like Phase 2"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Start from</legend>
          {STARTS.map((s) => (
            <label key={s.value} className="check">
              <input
                type="radio"
                name="start-from"
                checked={from === s.value}
                onChange={() => setFrom(s.value)}
              />
              <span>
                {s.label} <span className="hint">{s.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {saves.available ? (
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={saveFirst}
                onChange={(e) => setSaveFirst(e.target.checked)}
              />
              Save the current world first as
            </label>
            <input
              aria-label="Save name"
              value={saveAs}
              disabled={!saveFirst}
              onChange={(e) => setSaveAs(e.target.value)}
            />
          </div>
        ) : (
          <p className="warning">
            This browser does not allow local saves, so this can&apos;t be undone. Export the world
            as a file first to keep it.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Start new world
          </button>
        </div>
      </form>
    </div>
  );
}
