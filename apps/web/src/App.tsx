import type { LayoutEngine } from '@sps/graph';
import type { World } from '@sps/world';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { ErrorBoundary } from './ErrorBoundary';
import { ExportWorld, FactoryView } from './factory/FactoryView';
import type { Saves } from './persistence/saves';
import { SavePanel, type ModelerFiles } from './persistence/SavePanel';
import { announceNewWorld, NewWorldDialog } from './persistence/NewWorldDialog';
import { restorePrevious, startNewWorld } from './persistence/newWorld';
import type { Boot } from './persistence/session';
import type { SolverClient } from './solver/client';
import type { Catalog } from './solver/protocol';
import type { WorldStore } from './store';
import { useWorldPlan } from './useWorldPlan';
import { breadcrumb } from './world/viewModel';
import { CommandPalette, type Command } from './CommandPalette';
import { LogoMark, SearchIcon } from './ui/icons';
import { ThemeSwitch } from './ui/ThemeSwitch';
import { ToastProvider, useToast } from './ui/toasts';
import { WorldView, type StartActions } from './world/WorldView';
import { EscapeContext, escapeStack, isTextField } from './escape';
import { backOut, factoryView, focusOf, parentLookup, WORLD_VIEW, type View } from './viewPath';

/** Where the user is: the world canvas (home), or one factory drilled into. */
export type { View } from './viewPath';

export function App(props: {
  client: SolverClient;
  store: WorldStore;
  layout: LayoutEngine;
  saves: Saves;
  boot: Boot;
}) {
  return (
    <ToastProvider>
      <AppFrame {...props} />
    </ToastProvider>
  );
}

function AppFrame(props: {
  client: SolverClient;
  store: WorldStore;
  layout: LayoutEngine;
  saves: Saves;
  boot: Boot;
}) {
  const { client, store, layout, saves, boot } = props;
  const mismatch = useStore(store, (s) => s.dataHashMismatch);
  const world = useStore(store, (s) => s.world);
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [initError, setInitError] = useState<string | undefined>();
  const [view, setView] = useState<View>(WORLD_VIEW);
  const [palette, setPalette] = useState(false);
  const [newWorld, setNewWorld] = useState(false);
  const toast = useToast();
  const escape = useMemo(() => escapeStack(), []);
  // Starting over (N1–N7): the dialog, Ctrl+K entries and the start screen.
  const actions: Command[] = [
    { id: 'new-world', label: 'New world', hint: 'Start over', run: () => setNewWorld(true) },
  ];
  // Read on each render, so an open palette sees a backup a load just made.
  if (palette && saves.readBackup() !== undefined)
    actions.push({
      id: 'restore-world',
      label: 'Restore previous world',
      hint: 'Undo a load',
      run: () => toast(restorePrevious(store, saves) ?? 'Restored the previous world.'),
    });
  const start = useMemo(
    () => ({
      sample: () => {
        const out = startNewWorld(store, saves, { from: 'sample', name: '' });
        if (out.ok) announceNewWorld(toast, store, saves, out.undoable);
      },
      importFile: () => {
        const menu = document.querySelector<HTMLDetailsElement>('details.saves');
        if (!menu) return;
        menu.open = true;
        menu.querySelector<HTMLInputElement>('input[type=file]')?.focus();
      },
    }),
    [saves, store, toast],
  );
  // Modeler files (M14) run in the solver worker, on the world as it is now.
  const modeler = useMemo<ModelerFiles>(
    () => ({
      async importText(text) {
        const at = new Date().toISOString();
        const world = store.getState().world;
        const o = await client.solve({ world, action: { kind: 'import-modeler', text, at } });
        return o?.edited && o.imported ? { world: o.edited, ...o.imported } : null;
      },
      async exportWorld() {
        const world = store.getState().world;
        const o = await client.solve({ world, action: { kind: 'export-modeler' } });
        return o?.sfmd ?? null;
      },
    }),
    [client, store],
  );
  // A view of a factory that no longer exists (deleted, or a load replaced the world) is the world.
  const focus = focusOf(view, (id) => world.factories.some((f) => f.id === id));

  useEffect(() => {
    client.ready.then(
      (r) => {
        store.getState().attachData(r.dataHash);
        setCatalog(r.catalog);
      },
      (e: unknown) => setInitError((e as Error).message),
    );
  }, [client, store]);

  // Ctrl+K (Cmd+K) opens quick search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Esc steps back one thing at a time (A42): out of a text field, then the
  // latest open layer, then one level up the view path. Menus and dialogs that
  // handle Esc themselves mark the event handled.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = document.activeElement;
      if (isTextField(el)) el.blur();
      else if (!escape.pop()) setView(backOut);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escape]);

  return (
    <EscapeContext.Provider value={escape}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <LogoMark />
            <h1>Sat-Plus-Solver</h1>
            {world.meta.name && (
              <span className="world-name" title="World name">
                {world.meta.name}
              </span>
            )}
          </div>
          <Breadcrumb
            world={world}
            focus={focus}
            onWorld={() => setView(WORLD_VIEW)}
            onFactory={(id) => setView(factoryView(id, parentLookup(world)))}
          />
          <div className="topbar-actions">
            <button
              type="button"
              className="search-button"
              onClick={() => setPalette(true)}
              disabled={!catalog}
              title="Quick search (Ctrl+K)"
            >
              <SearchIcon />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </button>
            <SavePanel
              store={store}
              saves={saves}
              boot={boot}
              modeler={modeler}
              onNewWorld={() => setNewWorld(true)}
            />
            <ThemeSwitch />
          </div>
        </header>
        <main className={focus !== undefined ? 'main factory-main' : 'main world-main'}>
          {mismatch && (
            <p className="warning banner" role="alert">
              This plan was made with different game data ({mismatch.world}); the loaded data is{' '}
              {mismatch.model}. Results may differ.{' '}
              <button type="button" onClick={() => store.getState().useCurrentData()}>
                Use current data
              </button>
            </p>
          )}
          {initError ? (
            <p className="error" role="alert">
              The solver failed to start: {initError}
            </p>
          ) : !catalog ? (
            <p aria-busy="true" role="status" className="loading">
              Loading the solver…
            </p>
          ) : (
            <ErrorBoundary what="the app" recovery={<ExportWorld store={store} />}>
              <Shell
                client={client}
                store={store}
                layout={layout}
                catalog={catalog}
                focus={focus}
                onView={setView}
                start={start}
              />
              {palette && (
                <CommandPalette
                  store={store}
                  catalog={catalog}
                  focus={focus}
                  onView={setView}
                  onClose={() => setPalette(false)}
                  actions={actions}
                />
              )}
              {newWorld && (
                <NewWorldDialog store={store} saves={saves} onClose={() => setNewWorld(false)} />
              )}
            </ErrorBoundary>
          )}
        </main>
      </div>
    </EscapeContext.Provider>
  );
}

/**
 * Where the user is: World, the factory's groups, its parent factories (A49),
 * then the factory, which is also a switcher to the other factories.
 */
function Breadcrumb(props: {
  world: World;
  focus: string | undefined;
  onWorld(): void;
  onFactory(id: string): void;
}) {
  const { world, focus, onWorld, onFactory } = props;
  const crumbs = focus !== undefined ? breadcrumb(world, focus) : undefined;
  return (
    <nav aria-label="Breadcrumb" className="breadcrumb">
      <ol>
        <li>
          {crumbs ? (
            <button type="button" className="crumb" onClick={onWorld}>
              World
            </button>
          ) : (
            <span aria-current="page" className="crumb current">
              World
            </span>
          )}
        </li>
        {crumbs?.groups.map((g, k) => (
          <li key={k}>
            <button type="button" className="crumb" onClick={onWorld}>
              {g}
            </button>
          </li>
        ))}
        {crumbs?.parents.map((p) => (
          <li key={p.id}>
            <button type="button" className="crumb" onClick={() => onFactory(p.id)}>
              {p.name}
            </button>
          </li>
        ))}
        {crumbs && focus !== undefined && (
          <li>
            <select
              aria-label="Factory"
              aria-current="page"
              className="crumb-select"
              value={focus}
              onChange={(e) => onFactory(e.target.value)}
            >
              {world.factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </li>
        )}
      </ol>
    </nav>
  );
}

/**
 * The world view and the factory views. The world is solved once for both
 * (in the worker); the factory view also gets its factory's plan as solved in
 * the world, with its link demand and imports.
 */
function Shell(props: {
  client: SolverClient;
  store: WorldStore;
  layout: LayoutEngine;
  catalog: Catalog;
  focus: string | undefined;
  onView(view: View): void;
  start: StartActions;
}) {
  const { client, store, layout, catalog, focus, onView, start } = props;
  const world = useStore(store, (s) => s.world);
  const { state, run } = useWorldPlan(client, world, focus);
  const [actionError, setActionError] = useState<string>();
  const openFactory = useCallback(
    (id: string) => onView(factoryView(id, parentLookup(store.getState().world))),
    [onView, store],
  );
  const sizePower = (factoryId: string) => {
    setActionError(undefined);
    run({ kind: 'size-power', factoryId }).then(
      (outcome) => outcome?.edited && store.getState().replaceWorld(outcome.edited),
      (e: unknown) => setActionError(`Size power plant failed: ${(e as Error).message}`),
    );
  };

  return (
    <>
      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}
      <ErrorBoundary
        what={focus !== undefined ? 'the factory view' : 'the world view'}
        resetKey={focus}
        recovery={<ExportWorld store={store} />}
      >
        {focus !== undefined ? (
          <FactoryView
            key={focus}
            store={store}
            layout={layout}
            catalog={catalog}
            factoryId={focus}
            plan={state}
            run={run}
            onOpen={openFactory}
          />
        ) : (
          <WorldView
            world={world}
            store={store}
            catalog={catalog}
            layout={layout}
            plan={state}
            onOpen={openFactory}
            onSizePower={sizePower}
            start={start}
          />
        )}
      </ErrorBoundary>
    </>
  );
}
