import { recipeNodeId, type LayoutEngine } from '@sps/graph';
import { allocateRemaining, extractFactory, serializeWorld, type World } from '@sps/world';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { DiagnosticsList, useNames } from './Diagnostics';
import { factoryDiagnostics, withImport, withResourceLimit, type Fix } from './diagnostics';
import { ErrorBoundary } from './ErrorBoundary';
import { ImportsEditor } from './controls/ImportsEditor';
import { ResourceLimitsEditor } from './controls/ResourceLimitsEditor';
import { limitsLabel, rawResourcesOf } from './controls/resourceLimits';
import { RecipeToggles } from './controls/RecipeToggles';
import { SettingsPanel } from './controls/SettingsPanel';
import { TargetsEditor } from './controls/TargetsEditor';
import { Flowchart } from './flowchart/Flowchart';
import type { Saves } from './persistence/saves';
import { SavePanel } from './persistence/SavePanel';
import type { Boot } from './persistence/session';
import { downloadText, fileName, ShareControls } from './persistence/ShareControls';
import type { Selection } from './selection';
import type { SolveOutcome, SolverClient } from './solver/client';
import type { Catalog, FocusPlan, SolveProgress, WorldAction } from './solver/protocol';
import type { Scope, WorldStore } from './store';
import { SolvingNote } from './SolvingNote';
import { SummaryTable } from './SummaryTable';
import { BuildPanel } from './build/BuildPanel';
import { ManualPanel, ModeSwitch } from './manual/ManualPanel';
import { planToFreeze } from './manual/manual';
import { TweakPanel } from './tweaks/TweakPanel';
import type { Baseline } from './tweaks/tweaks';
import { useWorldPlan, type WorldPlanState } from './useWorldPlan';
import { breadcrumb } from './world/viewModel';
import { CommandPalette } from './CommandPalette';
import { PlanStats } from './PlanStats';
import { LogoMark, SearchIcon, SidebarIcon } from './ui/icons';
import { useSidebarOpen } from './ui/prefs';
import { ThemeSwitch } from './ui/ThemeSwitch';
import { ToastProvider, useToast } from './ui/toasts';
import { WorldView } from './world/WorldView';
import { EscapeContext, escapeStack, isTextField, useEscapeLayer } from './escape';
import { backOut, factoryView, focusOf, WORLD_VIEW, type View } from './viewPath';

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
  const escape = useMemo(() => escapeStack(), []);
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
          </div>
          <Breadcrumb
            world={world}
            focus={focus}
            onWorld={() => setView(WORLD_VIEW)}
            onFactory={(id) => setView(factoryView(id))}
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
            <SavePanel store={store} saves={saves} boot={boot} />
            <ThemeSwitch />
          </div>
        </header>
        <main className={focus !== undefined ? 'main factory-main' : 'main world-main'}>
          {mismatch && (
            <p className="warning banner" role="alert">
              This plan was made with different game data ({mismatch.world}); the loaded data is{' '}
              {mismatch.model}. Results may differ.
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
              />
              {palette && (
                <CommandPalette
                  store={store}
                  catalog={catalog}
                  focus={focus}
                  onView={setView}
                  onClose={() => setPalette(false)}
                />
              )}
            </ErrorBoundary>
          )}
        </main>
      </div>
    </EscapeContext.Provider>
  );
}

/**
 * Where the user is: World, the factory's groups, then the factory, which is
 * also a switcher to the other factories.
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

/** Recovery after a crash: the world as a file, straight from the store. */
function ExportWorld({ store }: { store: WorldStore }) {
  return (
    <button
      type="button"
      onClick={() => downloadText(fileName('world'), serializeWorld(store.getState().world, true))}
    >
      Export world
    </button>
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
}) {
  const { client, store, layout, catalog, focus, onView } = props;
  const world = useStore(store, (s) => s.world);
  const { state, run } = useWorldPlan(client, world, focus);
  const [actionError, setActionError] = useState<string>();
  const openFactory = useCallback((id: string) => onView(factoryView(id)), [onView]);
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
          />
        )}
      </ErrorBoundary>
    </>
  );
}

/** A factory's plan from a world solve, once the solve includes it. */
type PlanState =
  | { kind: 'idle' }
  | { kind: 'solving'; previous?: Focused; progress?: SolveProgress | undefined }
  | { kind: 'done'; outcome: Focused }
  | { kind: 'error'; message: string };
type Focused = FocusPlan & { ms: number };

function focused(o: SolveOutcome | undefined, factoryId: string): Focused | undefined {
  return o?.focus?.factoryId === factoryId ? { ...o.focus, ms: o.ms } : undefined;
}

/** One factory: its controls (M6) and its plan, with a switcher to the others. */
function FactoryView(props: {
  store: WorldStore;
  layout: LayoutEngine;
  catalog: Catalog;
  factoryId: string;
  plan: WorldPlanState;
  run(action: WorldAction): Promise<SolveOutcome | null>;
}) {
  const { store, layout, catalog, factoryId } = props;
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen();
  const [selection, setSelection] = useState<Selection>();
  // Esc clears the selection before it leaves the factory (A42).
  useEscapeLayer(selection !== undefined, () => setSelection(undefined));
  const world = useStore(store, (s) => s.world);
  const actions = store.getState();
  const factory = world.factories.find((f) => f.id === factoryId);
  const [scopeKind, setScopeKind] = useState<Scope['kind']>('factory');
  const scope = useMemo<Scope>(
    () => (scopeKind === 'world' ? { kind: 'world' } : { kind: 'factory', id: factoryId }),
    [scopeKind, factoryId],
  );
  const w = props.plan;
  const summary =
    w.kind === 'done' ? w.outcome.world : w.kind === 'solving' ? w.previous?.world : undefined;
  const manual = factory?.manual?.enabled === true;
  const idle =
    !!factory &&
    !manual &&
    factory.request.targets.length === 0 &&
    !world.links.some((l) => l.from === factoryId);
  const previous = focused(
    w.kind === 'done' ? w.outcome : w.kind === 'solving' ? w.previous : undefined,
    factoryId,
  );
  const plan: PlanState = idle
    ? { kind: 'idle' }
    : w.kind === 'error'
      ? w
      : w.kind === 'done' && previous
        ? { kind: 'done', outcome: previous }
        : {
            kind: 'solving',
            ...(previous ? { previous } : {}),
            ...(w.kind === 'solving' ? { progress: w.progress } : {}),
          };
  const outcome =
    plan.kind === 'done' ? plan.outcome : plan.kind === 'solving' ? plan.previous : undefined;
  const usage = useMemo(
    () => new Map(outcome?.plan.extraction.map((e) => [e.item, e.rate]) ?? []),
    [outcome],
  );
  const names = useNames(catalog, world);
  const mine = summary?.factories.find((f) => f.id === factoryId);
  const baseline = useMemo<Baseline | undefined>(
    () =>
      mine && {
        status: mine.status,
        machines: mine.machines,
        consumptionMW: mine.power.consumptionMW,
        extraction: mine.extraction,
      },
    [mine],
  );
  // Ctrl+Z (Cmd+Z) undoes the last manual edit, or plan tweak, except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey)
        return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      const s = store.getState();
      const f = s.world.factories.find((x) => x.id === factoryId);
      if (f?.manual?.enabled) s.undoManual(factoryId);
      else s.undoTweak(factoryId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, factoryId]);
  if (!factory) return <p className="error">Unknown factory “{factoryId}”.</p>;
  const selectedNode = selection && outcome?.graph.nodes.find((n) => n.id === selection.id);
  const scoped: Scope = { kind: 'factory', id: factoryId };
  const fix = (f: Fix) => {
    if (f.kind === 'enable-recipe') actions.setRecipes(scoped, [f.recipe], true);
    else if (f.kind === 'add-import')
      actions.setUnassignedImports(
        factoryId,
        withImport(factory.unassignedImports, f.item, f.rate),
      );
    else if (f.kind === 'raise-resource')
      actions.setResources(factoryId, withResourceLimit(factory.resources, f.item, f.amount));
    else if (f.kind === 'allow-fluid-byproducts')
      actions.setSetting(scoped, 'avoidFluidByproducts', false);
  };
  const diagnostics = outcome && (
    <DiagnosticsList
      label="Plan diagnostics"
      views={factoryDiagnostics(outcome.plan.diagnostics, names, factory.resources)}
      onFix={fix}
    />
  );

  const toManual = (on: boolean) => {
    setSelection(undefined);
    if (on) actions.enterManual(factoryId, planToFreeze(outcome?.graph));
    else actions.leaveManual(factoryId);
  };

  const settings = (
    <fieldset className="plain" disabled={manual}>
      <TargetsEditor
        catalog={catalog.targets}
        targets={factory.request.targets}
        onChange={(t) => actions.setTargets(factoryId, t)}
      />
      <div className="scope" role="radiogroup" aria-label="Settings apply to">
        <span className="scope-label">Settings apply to</span>
        <div className="segmented">
          <label className={scopeKind === 'factory' ? 'checked' : undefined}>
            <input
              type="radio"
              name="scope"
              checked={scopeKind === 'factory'}
              onChange={() => setScopeKind('factory')}
            />
            This factory
          </label>
          <label className={scopeKind === 'world' ? 'checked' : undefined}>
            <input
              type="radio"
              name="scope"
              checked={scopeKind === 'world'}
              onChange={() => setScopeKind('world')}
            />
            World defaults (all factories)
          </label>
        </div>
      </div>
      <SettingsPanel store={store} scope={scope} catalog={catalog} />
      <details className="card">
        <summary>Recipes</summary>
        <RecipeToggles store={store} scope={scope} recipes={catalog.recipes} />
      </details>
      <details className="card">
        <summary>Imports ({factory.unassignedImports.length} unassigned)</summary>
        <ImportsEditor
          catalog={catalog.items}
          imports={factory.unassignedImports}
          onChange={(i) => actions.setUnassignedImports(factoryId, i)}
        />
      </details>
      <details className="card">
        <summary>Resources ({limitsLabel(factory.resources)})</summary>
        <ResourceLimitsEditor
          world={world}
          factory={factory}
          resources={catalog.resources}
          usage={usage}
          onChange={(r) => actions.setResources(factoryId, r)}
          {...(summary
            ? {
                onAllocateRemaining: () =>
                  actions.replaceWorld(
                    allocateRemaining(
                      world,
                      rawResourcesOf(catalog.resources, world.nodePool),
                      summary,
                      factoryId,
                    ),
                  ),
              }
            : {})}
        />
      </details>
      <details className="card">
        <summary>Share this factory</summary>
        <p className="hint">Shares this factory alone: its links become targets and imports.</p>
        <ShareControls
          world={() =>
            extractFactory(
              store.getState().world,
              factoryId,
              Object.fromEntries(summary?.links.map((l) => [l.id, l.requested]) ?? []),
            )
          }
          name={factory.name}
          what="this factory"
          disabled={
            !summary && world.links.some((l) => l.from === factoryId && l.mode.kind === 'pull')
          }
        />
      </details>
    </fieldset>
  );

  return (
    <div
      className={cls('factory', manual && 'manual', !sidebarOpen && 'sidebar-closed')}
      data-testid="factory-view"
    >
      <aside className="sidebar controls" aria-label="Factory controls">
        <div className="sidebar-head">
          <button
            type="button"
            className="icon-button"
            aria-expanded={sidebarOpen}
            aria-controls="factory-settings"
            aria-label={sidebarOpen ? 'Hide settings' : 'Show settings'}
            title={sidebarOpen ? 'Hide settings' : 'Show settings'}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <SidebarIcon />
          </button>
          {sidebarOpen && <h2>Settings</h2>}
        </div>
        <div id="factory-settings" className="sidebar-body" hidden={!sidebarOpen}>
          {manual ? (
            <>
              <p className="hint frozen-note">
                These settings are frozen in manual mode. Switch back to Solver to change them.
              </p>
              <details className="card frozen">
                <summary>Frozen settings</summary>
                {settings}
              </details>
            </>
          ) : (
            settings
          )}
        </div>
      </aside>
      <section className="plan-pane" aria-label="Plan">
        <div className={cls('plan-toolbar', manual && 'manual')}>
          <ModeSwitch
            manual={manual}
            blocked={plan.kind === 'solving' ? 'Wait for the plan to finish solving.' : undefined}
            onChange={toManual}
          />
          <BuildPanel
            factory={factory}
            check={mine?.build}
            names={names}
            blocked={
              plan.kind === 'solving' || !mine
                ? 'Wait for the plan to finish solving.'
                : mine.status === 'infeasible'
                  ? 'This factory has no plan to mark.'
                  : undefined
            }
            onMark={() => {
              if (!mine) return;
              const again = factory.built !== undefined;
              actions.markBuilt(mine, new Date().toISOString());
              toast(again ? 'Marked the current plan as built again.' : 'Marked as built.');
            }}
            onRestore={() => {
              setSelection(undefined);
              actions.restoreBuild(factoryId);
              toast('Restored the plan as built, in manual mode.');
            }}
            onClear={() => {
              actions.clearBuilt(factoryId);
              toast('Cleared the build mark.');
            }}
          />
          {manual && factory.manual && (
            <ManualPanel
              factory={factory}
              recipes={catalog.recipes}
              node={selectedNode}
              missing={outcome?.manual?.missing.length ?? 0}
              onCount={(recipe, machines) => {
                actions.setManualCount(factoryId, recipe, machines);
                if (machines === 0) setSelection(undefined);
              }}
              onAdd={(recipe) => {
                actions.setManualCount(factoryId, recipe, 1);
                setSelection({ id: recipeNodeId(recipe), from: 'table' });
              }}
              onUndo={() => {
                actions.undoManual(factoryId);
                toast('Undid the last edit.');
              }}
              onRevert={() => {
                actions.revertManual(factoryId);
                toast('Reverted every manual edit.');
              }}
              onDiscard={() => {
                setSelection(undefined);
                actions.discardManual(factoryId);
                toast('Discarded the manual plan. The solver is back in charge.');
              }}
            />
          )}
          {outcome && !manual && (
            <TweakPanel
              world={world}
              factory={factory}
              recipes={catalog.recipes}
              names={names}
              node={selectedNode}
              baseline={baseline}
              run={props.run}
              onTweak={(t) => {
                actions.addTweak(factoryId, t);
                // Follow a swap to the recipe swapped in; a ban or an import removes the node.
                setSelection(
                  t.kind === 'swap' ? { id: recipeNodeId(t.to), from: 'table' } : undefined,
                );
              }}
              onUndo={() => {
                actions.undoTweak(factoryId);
                toast('Undid the last tweak.');
              }}
              onRemove={(k) => actions.removeTweak(factoryId, k)}
              onRevert={() => {
                actions.revertTweaks(factoryId);
                toast('Reverted every tweak. This is the solver’s own plan again.');
              }}
            />
          )}
        </div>
        <PlanView
          plan={plan}
          diagnostics={diagnostics}
          layout={layout}
          catalog={catalog}
          selection={selection}
          onSelect={(id, from) => setSelection(id === undefined ? undefined : { id, from })}
          onFocusTargets={() => {
            setSidebarOpen(true);
            // After the sidebar opens, put the cursor in the first target.
            requestAnimationFrame(() =>
              document.querySelector<HTMLInputElement>('.targets input')?.focus(),
            );
          }}
        />
      </section>
    </div>
  );
}

const cls = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ');

function PlanView(props: {
  plan: PlanState;
  diagnostics: ReactNode;
  layout: LayoutEngine;
  catalog: Catalog;
  selection: Selection | undefined;
  onSelect: (id: string | undefined, from: Selection['from']) => void;
  onFocusTargets(): void;
}) {
  const { plan, layout, catalog, selection, onSelect, diagnostics } = props;
  const solved = (o: Focused, timing: string) => (
    <>
      <PlanStats plan={o.plan} manual={o.manual !== undefined} timing={timing} />
      {diagnostics}
      <ErrorBoundary what="the flowchart" resetKey={o.graph}>
        <Flowchart
          engine={layout}
          graph={o.graph}
          catalog={catalog}
          selection={selection}
          onSelect={(id) => onSelect(id, 'graph')}
        />
      </ErrorBoundary>
      <SummaryTable
        plan={o.plan}
        manual={o.manual !== undefined}
        missing={o.manual?.missing}
        selection={selection}
        onSelect={(id) => onSelect(id, 'table')}
      />
    </>
  );
  switch (plan.kind) {
    case 'idle':
      return (
        <div className="empty-state">
          <h2>Nothing to plan yet</h2>
          <p>Pick an item and a rate to plan a factory.</p>
          <button type="button" className="primary" onClick={props.onFocusTargets}>
            Add a target
          </button>
        </div>
      );
    case 'error':
      return (
        <p className="error" role="alert">
          Solve failed: {plan.message}
        </p>
      );
    case 'solving':
      return (
        <div aria-busy="true">
          <SolvingNote progress={plan.progress} what="the plan" />
          {plan.previous && <div className="stale">{solved(plan.previous, 'Updating…')}</div>}
        </div>
      );
    case 'done':
      return (
        <div aria-busy="false" data-testid="plan">
          {solved(
            plan.outcome,
            `${plan.outcome.manual ? 'Computed' : 'Solved'} in ${Math.round(plan.outcome.ms)} ms`,
          )}
        </div>
      );
  }
}
