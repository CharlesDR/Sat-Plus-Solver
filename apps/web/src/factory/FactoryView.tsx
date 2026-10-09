/**
 * One factory's view (M6): its controls and its plan. The full planner opens
 * it from the world; simple mode (A72) shows only this, for its one factory.
 */
import { groupAreas, recipeNodeId, type FactoryGraph, type LayoutEngine } from '@sps/graph';
import { allocateRemaining, extractFactory, serializeWorld, type FactoryAreas } from '@sps/world';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { areaCatalog, areaChoices } from '../flowchart/areas';
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
import type { Scope, WorldStore } from '../store';
import { SolvingNote } from '../SolvingNote';
import { SummaryTable } from '../SummaryTable';
import { BuildPanel } from '../build/BuildPanel';
import { NestPanel } from '../nest/NestPanel';
import { ManualPanel, ModeSwitch } from '../manual/ManualPanel';
import { planToFreeze } from '../manual/manual';
import { TweakPanel } from '../tweaks/TweakPanel';
import type { Baseline } from '../tweaks/tweaks';
import type { WorldPlanState } from '../useWorldPlan';
import { PlanStats } from '../PlanStats';
import { SidebarIcon } from '../ui/icons';
import { useSidebarOpen } from '../ui/prefs';
import { useToast } from '../ui/toasts';
import { useEscapeLayer } from '../escape';

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
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen();
  const [selection, setSelection] = useState<Selection>();
  // Collapsed flowchart areas (A64), for this visit to this factory only.
  const [collapsed, setCollapsed] = useState<{ factory: string; areas: ReadonlySet<string> }>();
  const shut = collapsed?.factory === factoryId ? collapsed.areas : NONE;
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
      {!simple && (
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
      )}
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
          {!simple && (
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
          {!simple && (
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
          areas={{
            settings: factory?.areas,
            collapsed: shut,
            onCollapse: (areas) => setCollapsed({ factory: factoryId, areas }),
            onChange: (change) => actions.setFactoryAreas(factoryId, change),
          }}
          diagnostics={diagnostics}
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

/** A factory's flowchart areas (A64): its settings, and which areas are collapsed. */
interface PlanAreas {
  settings: FactoryAreas | undefined;
  collapsed: ReadonlySet<string>;
  onCollapse(areas: ReadonlySet<string>): void;
  onChange(change: AreaChange): void;
}
type AreaChange = {
  names?: Record<string, string | undefined>;
  moves?: Record<string, string | undefined>;
};

const cls = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ');

function PlanView(props: {
  plan: PlanState;
  areas: PlanAreas;
  diagnostics: ReactNode;
  layout: LayoutEngine;
  catalog: Catalog;
  selection: Selection | undefined;
  onSelect: (id: string | undefined, from: Selection['from']) => void;
  onFocusTargets(): void;
  onOpenFactory(id: string): void;
}) {
  const { plan, layout, catalog, selection, onSelect, diagnostics } = props;
  const solved = (o: Focused, timing: string) => (
    <>
      <PlanStats plan={o.plan} manual={o.manual !== undefined} timing={timing} />
      {diagnostics}
      <ErrorBoundary what="the flowchart" resetKey={o.graph}>
        <PlanFlowchart
          engine={layout}
          graph={o.graph}
          catalog={catalog}
          areas={props.areas}
          selection={selection}
          onSelect={(id) => onSelect(id, 'graph')}
          onOpenFactory={props.onOpenFactory}
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

/** The plan's flowchart, grouped in areas when it is large enough (A64). */
function PlanFlowchart(props: {
  engine: LayoutEngine;
  graph: FactoryGraph;
  catalog: Catalog;
  areas: PlanAreas;
  selection: Selection | undefined;
  onSelect: (id: string | undefined) => void;
  onOpenFactory(id: string): void;
}) {
  const { graph, catalog, areas } = props;
  const { settings, collapsed, onCollapse, onChange } = areas;
  const lookup = useMemo(() => areaCatalog(catalog), [catalog]);
  const grouped = useMemo(
    () => groupAreas(graph, lookup, settings, collapsed),
    [graph, lookup, settings, collapsed],
  );
  const controls = useMemo<AreaControls | undefined>(() => {
    if (!grouped.areas) return undefined;
    const defaults = new Map(catalog.areas.map((a) => [a.id, a.name]));
    return {
      choices: areaChoices(catalog, settings),
      collapsed: grouped.areas.some((a) => a.collapsed),
      moves: settings?.moves ?? {},
      setCollapsed: (area, shut) => {
        const next = new Set(collapsed);
        if (shut) next.add(area);
        else next.delete(area);
        onCollapse(next);
      },
      expandAll: () => onCollapse(NONE),
      // A name back to the default drops the rename.
      rename: (area, name) =>
        onChange({ names: { [area]: name.trim() === defaults.get(area) ? undefined : name } }),
      move: (node, area) => onChange({ moves: { [node]: area } }),
    };
  }, [grouped, catalog, settings, collapsed, onCollapse, onChange]);
  return (
    <Flowchart
      engine={props.engine}
      graph={grouped}
      catalog={catalog}
      selection={props.selection}
      onSelect={props.onSelect}
      onOpenFactory={props.onOpenFactory}
      {...(controls ? { areas: controls } : {})}
    />
  );
}
