/**
 * One factory's view (M6): its controls and its plan. The full planner opens
 * it from the world; simple mode (A72) shows only this, for its one factory.
 */
import { groupAreas, recipeNodeId, type FactoryGraph, type LayoutEngine } from '@sps/graph';
import { allocateRemaining, extractFactory, serializeWorld, type FactoryAreas } from '@sps/world';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { DiagnosticsList, useNames } from '../Diagnostics';
import { factoryDiagnostics, withImport, withResourceLimit, type Fix } from '../diagnostics';
import { ErrorBoundary } from '../ErrorBoundary';
import { ImportsEditor } from '../controls/ImportsEditor';
import { ResourceLimitsEditor } from '../controls/ResourceLimitsEditor';
import { limitsLabel, rawResourcesOf } from '../controls/resourceLimits';
import { RecipeToggles } from '../controls/RecipeToggles';
import { SettingsPanel } from '../controls/SettingsPanel';
import { TargetsEditor } from '../controls/TargetsEditor';
import { areaCatalog, areaChoices, autoCollapsed, planKey } from '../flowchart/areas';
import { Flowchart, type AreaControls } from '../flowchart/Flowchart';
import {
  downloadText,
  fileName,
  modelerFileName,
  ShareControls,
} from '../persistence/ShareControls';
import type { Selection } from '../selection';
import type { SolveOutcome } from '../solver/client';
import type { Catalog, FocusPlan, SolveProgress, WorldAction } from '../solver/protocol';
import { effectiveSettings, type Scope, type WorldStore } from '../store';
import { SolvingNote } from '../SolvingNote';
import { SummaryTable } from '../SummaryTable';
import { BuildPanel } from '../build/BuildPanel';
import { NestPanel } from '../nest/NestPanel';
import { ManualPanel, ModeSwitch } from '../manual/ManualPanel';
import { planToFreeze } from '../manual/manual';
import { TweakPanel } from '../tweaks/TweakPanel';
import { SuggestedImports } from './SuggestedImports';
import type { Baseline } from '../tweaks/tweaks';
import type { WorldPlanState } from '../useWorldPlan';
import { PlanStats } from '../PlanStats';
import { CloseIcon, SidebarIcon } from '../ui/icons';
import { DRAWER_QUERY, useMediaQuery } from '../ui/media';
import {
  useOpenPref,
  usePlanView,
  useSidebarOpen,
  useStatsScope,
  type PlanView as ViewChoice,
} from '../ui/prefs';
import { useItemLookup } from '../controls/itemRows';
import { STATS_SCOPES, isStatsScope, scopeView, type ScopeWorld } from '../stats/scope';
import { useToast } from '../ui/toasts';
import { isShortcut, useEscapeLayer } from '../escape';
import { BUILD_STATE } from '../build/build';

/** Recovery after a crash: the world as a file, straight from the store. */
export function ExportWorld({ store }: { store: WorldStore }) {
  return (
    <button
      type="button"
      onClick={() => downloadText(fileName('world'), serializeWorld(store.getState().world, true))}
    >
      Export world
    </button>
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

/** One factory: its controls (M6) and its plan. */
export function FactoryView(props: {
  store: WorldStore;
  layout: LayoutEngine;
  catalog: Catalog;
  factoryId: string;
  plan: WorldPlanState;
  run(action: WorldAction): Promise<SolveOutcome | null>;
  /** Opens a factory along its parent chain (A49). */
  onOpen(id: string): void;
  /**
   * Simple mode (A72): the world is this one factory, so there is no settings
   * scope switch, no nesting or build mark, and sharing shares the whole save.
   */
  simple?: boolean;
}) {
  const { store, layout, catalog, factoryId, onOpen, simple = false } = props;
  const toast = useToast();
  const [wideOpen, setWideOpen] = useSidebarOpen();
  // Under 1100 px the settings are a drawer over the plan (UX-14). It starts
  // closed on each visit, so the plan stays in view, and Esc or the scrim close it.
  const narrow = useMediaQuery(DRAWER_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarOpen = narrow ? drawerOpen : wideOpen;
  const setSidebarOpen = narrow ? setDrawerOpen : setWideOpen;
  useEscapeLayer(narrow && drawerOpen, () => setDrawerOpen(false));
  const [selection, setSelection] = useState<Selection>();
  // Collapsed flowchart areas (A64), for this visit to this factory only, and
  // the plan they were chosen for (A89).
  const [collapsed, setCollapsed] = useState<{ factory: string } & Collapsed>();
  const shut = collapsed?.factory === factoryId ? collapsed : undefined;
  const onCollapse = useCallback(
    (c: Collapsed) => setCollapsed({ factory: factoryId, ...c }),
    [factoryId],
  );
  // Esc clears the selection before it leaves the factory (A42).
  useEscapeLayer(selection !== undefined, () => setSelection(undefined));
  const world = useStore(store, (s) => s.world);
  const actions = store.getState();
  const factory = world.factories.find((f) => f.id === factoryId);
  const [scopeKind, setScopeKind] = useState<Scope['kind']>('factory');
  // Toolbar panels start closed unless in use (UX-2): built, nested, tweaked.
  const children = world.factories.filter((f) => f.parentId === factoryId);
  const [buildOpen, setBuildOpen] = useOpenPref('build', factory?.built !== undefined);
  const [nestOpen, setNestOpen] = useOpenPref(
    'nest',
    factory?.parentId !== undefined || children.length > 0,
  );
  const [tweaksOpen, setTweaksOpen] = useOpenPref('tweaks', (factory?.tweaks.length ?? 0) > 0);
  const [view, setView] = usePlanView();
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
  // One-key shortcuts (UX-13): M switches Solver/Manual, / filters the recipes.
  const switchMode = useRef<() => void>(() => {});
  useEffect(() => {
    switchMode.current = () => {
      if (!manual && plan.kind === 'solving') return;
      setSelection(undefined);
      if (manual) actions.leaveManual(factoryId);
      else actions.enterManual(factoryId, planToFreeze(outcome?.graph));
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcut(e, 'm')) {
        e.preventDefault();
        switchMode.current();
      } else if (isShortcut(e, '/')) {
        const filter = document.querySelector<HTMLInputElement>('[data-shortcut=filter-recipes]');
        if (!filter) return;
        e.preventDefault();
        filter.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
    <>
      <DiagnosticsList
        label="Plan diagnostics"
        views={factoryDiagnostics(outcome.plan.diagnostics, names, factory.resources)}
        onFix={fix}
      />
      {!manual && (
        <SuggestedImports
          world={world}
          factoryId={factoryId}
          graph={outcome.graph}
          fluids={catalog.fluids}
          itemName={names.item}
          run={props.run}
          onImport={(item) => {
            actions.setUnassignedImports(factoryId, [...factory.unassignedImports, { item }]);
            toast(`Imported ${names.item(item)}: the plan no longer makes it here.`);
          }}
        />
      )}
    </>
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
        maxTier={effectiveSettings(world, factoryId).values.maxTier}
        onChange={(t) => actions.setTargets(factoryId, t)}
      />
      {!simple && (
        <label className="scope-chip">
          Settings apply to{' '}
          <select
            aria-label="Settings apply to"
            value={scopeKind}
            onChange={(e) => setScopeKind(e.target.value as Scope['kind'])}
          >
            <option value="factory">This factory</option>
            <option value="world">World defaults (all factories)</option>
          </select>
        </label>
      )}
      <SettingsPanel store={store} scope={scope} catalog={catalog} simple={simple} />
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
        {!simple && (
          <p className="hint">Shares this factory alone: its links become targets and imports.</p>
        )}
        <ShareControls
          world={() =>
            simple
              ? store.getState().world
              : extractFactory(
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
        <div className="row">
          <button
            type="button"
            onClick={() =>
              props.run({ kind: 'export-modeler', factoryId }).then(
                (o) => {
                  if (o?.sfmd !== undefined) downloadText(modelerFileName(factory.name), o.sfmd);
                },
                (e: unknown) => toast(`Modeler export failed: ${(e as Error).message}`),
              )
            }
          >
            Export to Modeler
          </button>
        </div>
      </details>
    </fieldset>
  );

  return (
    <div
      className={cls(
        'factory-view',
        manual && 'manual',
        !sidebarOpen && 'sidebar-closed',
        narrow && 'drawer',
      )}
      data-testid="factory-view"
    >
      {narrow && sidebarOpen && (
        <div className="drawer-scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
      )}
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
          {sidebarOpen && !narrow && <h2>Settings</h2>}
        </div>
        <div id="factory-settings" className="sidebar-body" hidden={!sidebarOpen}>
          {narrow && (
            <div className="sidebar-head drawer-head">
              <h2>Settings</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close settings"
                title="Close settings"
                onClick={() => setDrawerOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>
          )}
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
          <div className="toolbar-row">
            <ModeSwitch
              manual={manual}
              blocked={plan.kind === 'solving' ? 'Wait for the plan to finish solving.' : undefined}
              onChange={toManual}
            />
            {!simple && (
              <Toggle open={buildOpen} onToggle={setBuildOpen}>
                Build
                <span className="toggle-state">
                  {factory.built
                    ? mine?.build
                      ? BUILD_STATE[mine.build.state].label
                      : 'marked'
                    : 'not marked'}
                </span>
              </Toggle>
            )}
            {!simple && (
              <Toggle open={nestOpen} onToggle={setNestOpen}>
                Sub-factories
                <span className="toggle-state">
                  {children.length || (factory.parentId ? 'inside' : 'none')}
                </span>
              </Toggle>
            )}
            {outcome && !manual && (
              <Toggle open={tweaksOpen} onToggle={setTweaksOpen}>
                Tweaks
                <span className="toggle-state">{factory.tweaks.length}</span>
              </Toggle>
            )}
            <ViewSwitch view={view} onChange={setView} />
          </div>
          {!simple && buildOpen && (
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
          )}
          {!simple && nestOpen && (
            <NestPanel
              world={world}
              factory={factory}
              solved={summary?.factories}
              onOpen={onOpen}
              onAdd={() => {
                const id = actions.addFactory('', undefined, factoryId);
                toast('Added a sub-factory.');
                onOpen(id);
              }}
              onMove={(parentId) => {
                try {
                  actions.setFactoryParent(factoryId, parentId);
                  toast(parentId ? 'Moved inside another factory.' : 'Moved to the top level.');
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            />
          )}
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
              open={tweaksOpen}
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
          view={view}
          factoryId={factoryId}
          areas={{
            settings: factory?.areas,
            collapsed: shut,
            onCollapse,
            onChange: (change) => actions.setFactoryAreas(factoryId, change),
          }}
          diagnostics={diagnostics}
          world={simple ? undefined : summary}
          onOpenFactory={onOpen}
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

const NONE: ReadonlySet<string> = new Set();

/** A toolbar button that opens and closes one panel below the toolbar (UX-2). */
function Toggle(props: { open: boolean; onToggle(open: boolean): void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="toolbar-toggle"
      aria-expanded={props.open}
      onClick={() => props.onToggle(!props.open)}
    >
      {props.children}
      <span className="chevron" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

const VIEWS: readonly { id: ViewChoice; label: string }[] = [
  { id: 'both', label: 'Both' },
  { id: 'graph', label: 'Graph' },
  { id: 'table', label: 'Table' },
];

/** Flowchart, tables, or both (UX-3), kept as a preference. */
function ViewSwitch(props: { view: ViewChoice; onChange(v: ViewChoice): void }) {
  return (
    <div className="segmented view-switch" role="radiogroup" aria-label="Plan view">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          role="radio"
          aria-checked={props.view === v.id}
          onClick={() => props.onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** Collapsed areas, and the plan (`planKey`) they were chosen for (A89). */
type Collapsed = { key: string; areas: ReadonlySet<string> };

/** A factory's flowchart areas (A64): its settings, and which areas are collapsed. */
interface PlanAreas {
  settings: FactoryAreas | undefined;
  /** Undefined until the first plan is drawn. */
  collapsed: Collapsed | undefined;
  onCollapse(collapsed: Collapsed): void;
  onChange(change: AreaChange): void;
}
type AreaChange = {
  names?: Record<string, string | undefined>;
  moves?: Record<string, string | undefined>;
};

const cls = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ');

function PlanView(props: {
  plan: PlanState;
  view: ViewChoice;
  factoryId: string;
  areas: PlanAreas;
  diagnostics: ReactNode;
  /** The world result the stats scope sums over (A81); undefined hides the scope picker. */
  world: ScopeWorld | undefined;
  layout: LayoutEngine;
  catalog: Catalog;
  selection: Selection | undefined;
  onSelect: (id: string | undefined, from: Selection['from']) => void;
  onFocusTargets(): void;
  onOpenFactory(id: string): void;
}) {
  const { plan, layout, catalog, selection, onSelect, diagnostics, world } = props;
  const [statsScope, setStatsScope] = useStatsScope();
  const items = useItemLookup(catalog.items);
  const nodeLabels = useMemo(() => new Map(catalog.nodes.map((n) => [n.id, n.label])), [catalog]);
  const scopeId = useId();
  const solved = (o: Focused, timing: string) => {
    const scope = world
      ? scopeView({
          scope: statsScope,
          factoryId: props.factoryId,
          world,
          selection: selection?.id,
          recipes: o.plan.recipes,
          itemName: items.name,
          nodeLabel: (id) => nodeLabels.get(id) ?? id,
        })
      : undefined;
    return (
      <>
        {world && (
          <div className="stats-scope">
            <label htmlFor={scopeId}>Stats for</label>
            <select
              id={scopeId}
              value={statsScope}
              title="Which factories the plan stats sum over. Flows between them net out."
              onChange={(e) => {
                if (isStatsScope(e.target.value)) setStatsScope(e.target.value);
              }}
            >
              {STATS_SCOPES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <PlanStats plan={o.plan} manual={o.manual !== undefined} timing={timing} scope={scope} />
        {diagnostics}
        {props.view !== 'table' && (
          <ErrorBoundary what="the flowchart" resetKey={o.graph}>
            <PlanFlowchart
              engine={layout}
              graph={o.graph}
              catalog={catalog}
              areas={props.areas}
              selection={selection}
              onSelect={(id) => onSelect(id, 'graph')}
              onOpenFactory={props.onOpenFactory}
              viewKey={props.factoryId}
            />
          </ErrorBoundary>
        )}
        {props.view !== 'graph' && (
          <SummaryTable
            plan={o.plan}
            manual={o.manual !== undefined}
            missing={o.manual?.missing}
            scope={scope}
            selection={selection}
            onSelect={(id) => onSelect(id, 'table')}
          />
        )}
      </>
    );
  };
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

/** The plan's flowchart, grouped in areas when it is large enough (A64). */
function PlanFlowchart(props: {
  engine: LayoutEngine;
  graph: FactoryGraph;
  catalog: Catalog;
  areas: PlanAreas;
  selection: Selection | undefined;
  onSelect: (id: string | undefined) => void;
  onOpenFactory(id: string): void;
  viewKey: string;
}) {
  const { graph, catalog, areas } = props;
  const { settings, onChange } = areas;
  const lookup = useMemo(() => areaCatalog(catalog), [catalog]);
  // A new plan (other recipes, or grouped another way) collapses its big
  // areas (A89); the buttons change only what is shown until the next one.
  const key = useMemo(() => planKey(graph, settings), [graph, settings]);
  const fresh = areas.collapsed?.key !== key;
  const auto = useMemo(
    () => (fresh ? autoCollapsed(groupAreas(graph, lookup, settings)) : undefined),
    [fresh, graph, lookup, settings],
  );
  const collapsed = auto ?? areas.collapsed?.areas ?? NONE;
  const { onCollapse: store } = areas;
  useEffect(() => {
    if (auto) store({ key, areas: auto });
  }, [auto, key, store]);
  const onCollapse = useCallback(
    (shut: ReadonlySet<string>) => store({ key, areas: shut }),
    [store, key],
  );
  const grouped = useMemo(
    () => groupAreas(graph, lookup, settings, collapsed),
    [graph, lookup, settings, collapsed],
  );
  const pinch = settings?.by !== 'parts';
  // Pinch-point areas (A87) are the plan's own, so their default names are too.
  const unnamed = useMemo(
    () =>
      pinch && grouped.areas
        ? (groupAreas(graph, lookup, { ...settings, names: {} }).areas ?? [])
        : catalog.areas,
    [pinch, grouped, graph, lookup, settings, catalog],
  );
  const controls = useMemo<AreaControls | undefined>(() => {
    if (!grouped.areas) return undefined;
    const defaults = new Map(unnamed.map((a) => [a.id, a.name]));
    return {
      choices: pinch
        ? grouped.areas.map((a) => ({ id: a.id, name: a.name }))
        : areaChoices(catalog, settings),
      collapsed: grouped.areas.some((a) => a.collapsed),
      expanded: grouped.areas.some((a) => !a.collapsed),
      moves: settings?.moves ?? {},
      setCollapsed: (area, shut) => {
        const next = new Set(collapsed);
        if (shut) next.add(area);
        else next.delete(area);
        onCollapse(next);
      },
      expandAll: () => onCollapse(NONE),
      collapseAll: () => onCollapse(new Set(grouped.areas!.map((a) => a.id))),
      // A name back to the default drops the rename.
      rename: (area, name) =>
        onChange({ names: { [area]: name.trim() === defaults.get(area) ? undefined : name } }),
      move: (node, area) => onChange({ moves: { [node]: area } }),
    };
  }, [grouped, unnamed, pinch, catalog, settings, collapsed, onCollapse, onChange]);
  return (
    <Flowchart
      engine={props.engine}
      graph={grouped}
      catalog={catalog}
      selection={props.selection}
      onSelect={props.onSelect}
      onOpenFactory={props.onOpenFactory}
      viewKey={props.viewKey}
      {...(controls ? { areas: controls } : {})}
    />
  );
}
