/**
 * Suggested imports (A91): parts whose own upstream is a big share of the
 * plan, such as Plastic made from Crude Oil and Water. The list comes from the
 * plan's graph; opening it re-solves the factory importing each one, for
 * exact numbers, and "Import this" adds the part to the factory's imports.
 */
import { importSuggestions, type FactoryGraph } from '@sps/graph';
import type { World } from '@sps/world';
import { useEffect, useMemo, useState } from 'react';
import type { ImportPreviews, PlanSize, WorldAction } from '../solver/protocol';
import type { SolveOutcome } from '../solver/client';
import { useOpenPref } from '../ui/prefs';

/** Suggestions shown, best first. */
export const SUGGESTIONS = 3;

type Previews =
  | { kind: 'done'; previews: ImportPreviews }
  | { kind: 'interrupted' }
  | { kind: 'error'; message: string };

const list = (names: string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export function SuggestedImports(props: {
  world: World;
  factoryId: string;
  graph: FactoryGraph;
  fluids: readonly string[];
  itemName(id: string): string;
  run(action: WorldAction): Promise<SolveOutcome | null>;
  onImport(item: string): void;
}) {
  const { world, factoryId, graph, itemName, run } = props;
  const fluids = useMemo(() => new Set(props.fluids), [props.fluids]);
  const suggestions = useMemo(
    () => importSuggestions(graph, fluids).slice(0, SUGGESTIONS),
    [graph, fluids],
  );
  const [open, setOpen] = useOpenPref('suggested-imports');
  const key = open && suggestions.length ? suggestions.map((s) => s.item).join('\n') : '';
  const [settled, setSettled] = useState<{ world: World; key: string; previews: Previews }>();
  const previews = settled?.world === world && settled.key === key ? settled.previews : undefined;

  useEffect(() => {
    if (!key) return;
    let live = true;
    const done = (p: Previews) => live && setSettled({ world, key, previews: p });
    run({ kind: 'preview-imports', factoryId, items: key.split('\n') }).then(
      (o) =>
        done(
          o?.importPreviews
            ? { kind: 'done', previews: o.importPreviews }
            : { kind: 'interrupted' },
        ),
      (e: unknown) => done({ kind: 'error', message: (e as Error).message }),
    );
    return () => {
      live = false;
    };
  }, [key, world, factoryId, run]);

  if (!suggestions.length) return null;
  const before = previews?.kind === 'done' ? previews.previews.before : undefined;
  const after = (item: string) =>
    previews?.kind === 'done' ? previews.previews.after.find((p) => p.item === item) : undefined;
  return (
    <details
      className="suggested-imports"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Suggested imports ({suggestions.length})</summary>
      <ul>
        {suggestions.map((s) => {
          const a = after(s.item);
          return (
            <li key={s.item} data-item={s.item}>
              <div>
                <strong>{s.name}</strong>: made here by {s.boxes} recipe
                {s.boxes === 1 ? '' : 's'}
                {s.resources.length ? ` from ${list(s.resources.map(itemName))}` : ''}.
                {before && a && <Savings before={before} after={a} itemName={itemName} />}
                {previews?.kind === 'error' && <span className="hint"> {previews.message}</span>}
              </div>
              <button type="button" onClick={() => props.onImport(s.item)}>
                Import this
              </button>
            </li>
          );
        })}
      </ul>
      {!previews && open && <p className="hint">Solving with each import…</p>}
    </details>
  );
}

function Savings(props: { before: PlanSize; after: PlanSize; itemName(id: string): string }) {
  const { before, after } = props;
  if (after.status !== 'ok')
    return <span className="hint"> Importing it gives no plan ({after.status}).</span>;
  const dropped = before.resources.filter((r) => !after.resources.includes(r));
  return (
    <span className="num">
      {' '}
      Importing it: {before.recipes} → {after.recipes} recipes, {Math.ceil(before.machines)} →{' '}
      {Math.ceil(after.machines)} machines
      {dropped.length ? `, no more ${list(dropped.map(props.itemName))}` : ''}.
    </span>
  );
}
