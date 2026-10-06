import { recipeNodeId, type LayoutEngine } from '@sps/graph';
import { allocateRemaining, extractFactory, serializeWorld } from '@sps/world';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { Field } from './controls/Field';
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
import { ManualPanel, ModeSwitch } from './manual/ManualPanel';
import { planToFreeze } from './manual/manual';
import { TweakPanel } from './tweaks/TweakPanel';
import type { Baseline } from './tweaks/tweaks';
import { useWorldPlan, type WorldPlanState } from './useWorldPlan';
import { breadcrumb } from './world/viewModel';
import { WorldView } from './world/WorldView';

/** Where the user is: the world canvas (home), or one factory drilled into. */
type View = { kind: 'world' } | { kind: 'factory'; id: string };

export function App(props: {
  client: SolverClient;
  store: WorldStore;
  layout: LayoutEngine;
  saves: Saves;
  boot: Boot;
}) {
  const { client, store, layout, saves, boot } = props;
  const mismatch = useStore(store, (s) => s.dataHashMismatch);
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [initError, setInitError] = useState<string | undefined>();

  useEffect(() => {
    client.ready.then(
      (r) => {
        store.getState().attachData(r.dataHash);
        setCatalog(r.catalog);
      },
      (e: unknown) => setInitError((e as Error).message),
    );
  }, [client, store]);

  return (
    <main>
      <h1>Sat-Plus-Solver</h1>
      {mismatch && (
        <p className="warning" role="alert">
          This plan was made with different game data ({mismatch.world}); the loaded data is{' '}
          {mismatch.model}. Results may differ.
        </p>
      )}
      <SavePanel store={store} saves={saves} boot={boot} />
      {initError ? (
        <p className="error" role="alert">
          The solver failed to start: {initError}
        </p>
      ) : !catalog ? (
        <p aria-busy="true" role="status">
          Loading the solver…
        </p>
      ) : (
        <ErrorBoundary what="the app" recovery={<ExportWorld store={store} />}>
          <Shell client={client} store={store} layout={layout} catalog={catalog} />
        </ErrorBoundary>
      )}
    </main>
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
 * The world view and the factory views under one breadcrumb. The world is
 * solved once for both (in the worker); the factory view also gets its
 * factory's plan as solved in the world, with its link demand and imports.
 */
function Shell(props: {
  client: SolverClient;
  store: WorldStore;
  layout: LayoutEngine;
  catalog: Catalog;
}) {
  const { client, store, layout, catalog } = props;
  const world = useStore(store, (s) => s.world);
  const [view, setView] = useState<View>({ kind: 'world' });
  const open = world.factories.some((f) => view.kind === 'factory' && f.id === view.id);
  const focus = view.kind === 'factory' && open ? view.id : undefined;
  const { state, run } = useWorldPlan(client, world, focus);
  const [actionError, setActionError] = useState<string>();
  const openFactory = useCallback((id: string) => setView({ kind: 'factory', id }), []);
  const toWorld = () => setView({ kind: 'world' });
  const sizePower = (factoryId: string) => {
    setActionError(undefined);
    run({ kind: 'size-power', factoryId }).then(
      (outcome) => outcome?.edited && store.getState().replaceWorld(outcome.edited),
      (e: unknown) => setActionError(`Size power plant failed: ${(e as Error).message}`),
    );
  };
  const crumbs = focus !== undefined ? breadcrumb(world, focus) : undefined;

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol>
          <li>
            {crumbs ? (
              <button type="button" className="link-button" onClick={toWorld}>
                World
              </button>
            ) : (
              <span aria-current="page">World</span>
            )}
          </li>
          {crumbs?.groups.map((g, k) => (
            <li key={k}>
              <button type="button" className="link-button" onClick={toWorld}>
                {g}
              </button>
            </li>
          ))}
          {crumbs && (
            <li>
              <span aria-current="page">{crumbs.factory}</span>
            </li>
          )}
        </ol>
      </nav>
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
            onSwitch={openFactory}
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
  onSwitch(id: string): void;
}) {
  const { store, layout, catalog, factoryId, onSwitch } = props;
  const [selection, setSelection] = useState<Selection>();
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

  return (
    <div className={manual ? 'factory manual' : 'factory'}>
      <ModeSwitch
        manual={manual}
        blocked={plan.kind === 'solving' ? 'Wait for the plan to finish solving.' : undefined}
        onChange={toManual}
      />
      <section className="controls" aria-label="Factory controls">
        <div className="row">
          <Field label="Factory">
            {(id) => (
              <select id={id} value={factoryId} onChange={(e) => onSwitch(e.target.value)}>
                {world.factories.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {manual && (
          <p className="hint">
            These settings are frozen in manual mode. Switch back to Solver to change them.
          </p>
        )}
        <fieldset className="plain" disabled={manual}>
          <TargetsEditor
            catalog={catalog.targets}
            targets={factory.request.targets}
            onChange={(t) => actions.setTargets(factoryId, t)}
          />
          <div className="scope" role="radiogroup" aria-label="Settings apply to">
            <span>Settings apply to</span>
            <label className="check">
              <input
                type="radio"
                name="scope"
                checked={scopeKind === 'factory'}
                onChange={() => setScopeKind('factory')}
              />
              This factory
            </label>
            <label className="check">
              <input
                type="radio"
                name="scope"
                checked={scopeKind === 'world'}
                onChange={() => setScopeKind('world')}
              />
              World defaults (all factories)
            </label>
          </div>
          <SettingsPanel store={store} scope={scope} catalog={catalog} />
          <details>
            <summary>Share this factory</summary>
            <p>Shares this factory alone: its links become targets and imports.</p>
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
          <details>
            <summary>Recipes</summary>
            <RecipeToggles store={store} scope={scope} recipes={catalog.recipes} />
          </details>
          <details>
            <summary>Unassigned imports ({factory.unassignedImports.length})</summary>
            <ImportsEditor
              catalog={catalog.items}
              imports={factory.unassignedImports}
              onChange={(i) => actions.setUnassignedImports(factoryId, i)}
            />
          </details>
          <details>
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
        </fieldset>
      </section>
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
          onUndo={() => actions.undoManual(factoryId)}
          onRevert={() => actions.revertManual(factoryId)}
          onDiscard={() => {
            setSelection(undefined);
            actions.discardManual(factoryId);
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
            setSelection(t.kind === 'swap' ? { id: recipeNodeId(t.to), from: 'table' } : undefined);
          }}
          onUndo={() => actions.undoTweak(factoryId)}
          onRemove={(k) => actions.removeTweak(factoryId, k)}
          onRevert={() => actions.revertTweaks(factoryId)}
        />
      )}
      <PlanView
        plan={plan}
        diagnostics={diagnostics}
        layout={layout}
        selection={selection}
        onSelect={(id, from) => setSelection(id === undefined ? undefined : { id, from })}
      />
    </div>
  );
}

function PlanView(props: {
  plan: PlanState;
  diagnostics: ReactNode;
  layout: LayoutEngine;
  selection: Selection | undefined;
  onSelect: (id: string | undefined, from: Selection['from']) => void;
}) {
  const { plan, layout, selection, onSelect, diagnostics } = props;
  const solved = (o: Focused) => (
    <>
      {diagnostics}
      <ErrorBoundary what="the flowchart" resetKey={o.graph}>
        <Flowchart
          engine={layout}
          graph={o.graph}
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
      return <p>Pick an item and a rate to plan a factory.</p>;
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
          {plan.previous && <div className="stale">{solved(plan.previous)}</div>}
        </div>
      );
    case 'done':
      return (
        <div aria-busy="false" data-testid="plan">
          <p className="timing">
            {plan.outcome.manual ? 'Computed' : 'Solved'} in {Math.round(plan.outcome.ms)} ms.
          </p>
          {solved(plan.outcome)}
        </div>
      );
  }
}
