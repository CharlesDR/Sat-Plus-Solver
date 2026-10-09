/**
 * Simple mode (A72): one factory, its controls and its plan, with no world
 * view, links or nesting. It shares the factory view with the full planner
 * and keeps its own saves (`SIMPLE_PREFIX`).
 */
import type { LayoutEngine } from '@sps/graph';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { ErrorBoundary } from '../ErrorBoundary';
import { escapeStack, EscapeContext, isTextField } from '../escape';
import { ExportWorld, FactoryView } from '../factory/FactoryView';
import { NewWorldDialog } from '../persistence/NewWorldDialog';
import type { Saves } from '../persistence/saves';
import { SavePanel } from '../persistence/SavePanel';
import type { Boot } from '../persistence/session';
import type { SolverClient } from '../solver/client';
import type { Catalog } from '../solver/protocol';
import type { WorldStore } from '../store';
import { LogoMark } from '../ui/icons';
import { ThemeSwitch } from '../ui/ThemeSwitch';
import { ToastProvider, useToast } from '../ui/toasts';
import { useWorldPlan } from '../useWorldPlan';
import { keepOneFactory } from './oneFactory';

export function SimpleApp(props: {
  client: SolverClient;
  store: WorldStore;
  layout: LayoutEngine;
  saves: Saves;
  boot: Boot;
}) {
  return (
    <ToastProvider>
      <SimpleFrame {...props} />
    </ToastProvider>
  );
}

function SimpleFrame(props: {
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
  const [newWorld, setNewWorld] = useState(false);
  const toast = useToast();
  const escape = useMemo(() => escapeStack(), []);

  useEffect(() => {
    client.ready.then(
      (r) => {
        store.getState().attachData(r.dataHash);
        setCatalog(r.catalog);
      },
      (e: unknown) => setInitError((e as Error).message),
    );
  }, [client, store]);

  // Whatever is loaded (a file, a slot, a link, the sample) becomes one factory.
  useEffect(() => {
    const trim = () => {
      const out = keepOneFactory(store.getState().world);
      if (!out) return;
      store.getState().replaceWorld(out.world);
      if (out.kind === 'kept' && out.dropped > 0)
        toast(
          `Simple mode plans one factory: kept “${out.kept}” and left out ${out.dropped} more. Open the file in the full planner to see them all.`,
        );
    };
    trim();
    return store.subscribe((s, prev) => {
      if (s.world !== prev.world) trim();
    });
  }, [store, toast]);

  // Esc steps out of a text field, then closes the latest open layer (A42).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = document.activeElement;
      if (isTextField(el)) el.blur();
      else escape.pop();
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escape]);

  const factory = world.factories[0];
  return (
    <EscapeContext.Provider value={escape}>
      <div className="app simple">
        <header className="topbar">
          <div className="brand">
            <LogoMark />
            <h1>Sat-Plus-Solver</h1>
            <span className="mode-badge">Simple mode</span>
            {world.meta.name && (
              <span className="world-name" title="Save name">
                {world.meta.name}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            <a className="button-link" href="../">
              Full planner
            </a>
            <SavePanel
              store={store}
              saves={saves}
              boot={boot}
              onNewWorld={() => setNewWorld(true)}
            />
            <ThemeSwitch />
          </div>
        </header>
        <main className="main factory-main">
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
          ) : !catalog || !factory ? (
            <p aria-busy="true" role="status" className="loading">
              Loading the solver…
            </p>
          ) : (
            <ErrorBoundary what="the app" recovery={<ExportWorld store={store} />}>
              <SimpleFactory
                client={client}
                store={store}
                layout={layout}
                catalog={catalog}
                factoryId={factory.id}
              />
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

function SimpleFactory(props: {
  client: SolverClient;
  store: WorldStore;
  layout: LayoutEngine;
  catalog: Catalog;
  factoryId: string;
}) {
  const { client, store, layout, catalog, factoryId } = props;
  const world = useStore(store, (s) => s.world);
  const { state, run } = useWorldPlan(client, world, factoryId);
  return (
    <ErrorBoundary
      what="the factory view"
      resetKey={factoryId}
      recovery={<ExportWorld store={store} />}
    >
      <FactoryView
        key={factoryId}
        store={store}
        layout={layout}
        catalog={catalog}
        factoryId={factoryId}
        plan={state}
        run={run}
        onOpen={() => {}}
        simple
      />
    </ErrorBoundary>
  );
}
