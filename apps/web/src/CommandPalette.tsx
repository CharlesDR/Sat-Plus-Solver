/**
 * Quick search (Ctrl+K): jump to the world or a factory, make a factory, or
 * add a target to the open factory, from the keyboard.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { factoryView, WORLD_VIEW, type View } from './viewPath';
import { itemIcon } from './icons/icons';
import type { Catalog } from './solver/protocol';
import type { WorldStore } from './store';

interface Command {
  id: string;
  /** What the row says; also what the query matches. */
  label: string;
  hint: string;
  icon?: string | undefined;
  run(): void;
}

/** How many item rows ("Add target: …") to show at once. */
const ITEM_ROWS = 8;

export function CommandPalette(props: {
  store: WorldStore;
  catalog: Catalog;
  focus: string | undefined;
  onView(view: View): void;
  onClose(): void;
}) {
  const { store, catalog, focus, onView, onClose } = props;
  const world = useStore(store, (s) => s.world);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    input.current?.focus();
  }, []);

  const commands = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const has = (s: string) => !q || s.toLowerCase().includes(q);
    const out: Command[] = [];
    if (focus !== undefined && has('World'))
      out.push({
        id: 'world',
        label: 'World',
        hint: 'Go to',
        run: () => onView(WORLD_VIEW),
      });
    for (const f of world.factories)
      if (f.id !== focus && has(f.name))
        out.push({
          id: `factory:${f.id}`,
          label: f.name,
          hint: 'Open factory',
          run: () => onView(factoryView(f.id)),
        });
    if (has('New factory'))
      out.push({
        id: 'new-factory',
        label: 'New factory',
        hint: 'Create',
        run: () => onView(factoryView(store.getState().addFactory(''))),
      });
    const factory = world.factories.find((f) => f.id === focus);
    if (factory && q && !factory.manual?.enabled) {
      const items = catalog.targets.filter((i) => i.name.toLowerCase().includes(q));
      // Names that start with the query come first.
      items.sort(
        (a, b) =>
          Number(!a.name.toLowerCase().startsWith(q)) -
            Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name),
      );
      for (const i of items.slice(0, ITEM_ROWS))
        out.push({
          id: `target:${i.id}`,
          label: i.name,
          hint: 'Add target, 60/min',
          icon: itemIcon(i.id),
          run: () =>
            store
              .getState()
              .setTargets(factory.id, [
                ...factory.request.targets.filter((t) => t.item !== i.id),
                { item: i.id, rate: 60 },
              ]),
        });
    }
    return out;
  }, [query, world, focus, catalog.targets, store, onView]);

  const pick = (c: Command | undefined) => {
    if (!c) return;
    c.run();
    onClose();
  };
  const at = Math.min(active, Math.max(0, commands.length - 1));

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={commands[at] ? `${listId}-${at}` : undefined}
          aria-label="Search factories and items"
          placeholder={
            focus !== undefined
              ? 'Go to a factory, or type an item to add as a target…'
              : 'Go to a factory…'
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((at + 1) % Math.max(1, commands.length));
            else if (e.key === 'ArrowUp')
              setActive((at - 1 + commands.length) % Math.max(1, commands.length));
            else if (e.key === 'Enter') pick(commands[at]);
            else if (e.key === 'Escape') onClose();
            else return;
            e.preventDefault();
          }}
        />
        <ul id={listId} role="listbox" aria-label="Results">
          {commands.map((c, k) => (
            <li
              key={c.id}
              id={`${listId}-${k}`}
              role="option"
              aria-selected={k === at}
              onMouseEnter={() => setActive(k)}
              onClick={() => pick(c)}
            >
              {c.icon ? (
                <img src={c.icon} alt="" width={20} height={20} />
              ) : (
                <span className="palette-dot" aria-hidden="true" />
              )}
              <span className="palette-label">{c.label}</span>
              <span className="palette-hint">{c.hint}</span>
            </li>
          ))}
          {!commands.length && <li className="hint">Nothing matches “{query}”.</li>}
        </ul>
        <p className="palette-keys hint">↑ ↓ to move · Enter to pick · Esc to close</p>
      </div>
    </div>
  );
}
