/**
 * The world view, the app's home (PLAN M8): the canvas, item trace, the link
 * editor and the panels.
 */
import { MW_ITEM_ID } from '@sps/data';
import { worldGraph, type LayoutEngine } from '@sps/graph';
import type { World } from '@sps/world';
import { useCallback, useId, useMemo, useState } from 'react';
import { useItemLookup } from '../controls/itemRows';
import { DiagnosticsList, useNames } from '../Diagnostics';
import { worldDiagnostics, type Fix } from '../diagnostics';
import { ErrorBoundary } from '../ErrorBoundary';
import { SolvingNote } from '../SolvingNote';
import type { Catalog, WorldSummary } from '../solver/protocol';
import type { WorldStore } from '../store';
import type { WorldPlanState } from '../useWorldPlan';
import { LinkEditor, type LinkDraft } from './LinkEditor';
import {
  FactoriesPanel,
  GroupsPanel,
  LedgerPanel,
  LinksPanel,
  NodesPanel,
  PowerPanel,
} from './Panels';
import { traceableItems } from './viewModel';
import { WorldCanvas, type CanvasActions } from './WorldCanvas';
import { PlusIcon } from '../ui/icons';
import { useToast } from '../ui/toasts';
import { offBuildText } from '../build/build';

const TABS = ['Ledger', 'Factories', 'Links', 'Power', 'Nodes', 'Groups'] as const;
type Tab = (typeof TABS)[number];

export function WorldView(props: {
  world: World;
  store: WorldStore;
  catalog: Catalog;
  layout: LayoutEngine;
  plan: WorldPlanState;
  onOpen(factoryId: string): void;
  onSizePower(factoryId: string): void;
}) {
  const { world, store, catalog, layout, plan, onOpen, onSizePower } = props;
  const [tab, setTab] = useState<Tab>('Factories');
  const [traceItem, setTraceId] = useState<string>();
  const [traceText, setTraceText] = useState('');
  const [draft, setDraft] = useState<LinkDraft>();
  const [newName, setNewName] = useState('');
  const toast = useToast();
  const traceId = useId();
  const panelId = useId();
  const items = useItemLookup(catalog.items);
  const itemName = useCallback(
    (id: string) => (id === MW_ITEM_ID ? 'Power (MW)' : items.name(id)),
    [items],
  );
  const setTraceItem = (id: string | undefined) => {
    setTraceId(id);
    setTraceText(id === undefined ? '' : itemName(id));
  };
  const summary: WorldSummary | undefined =
    plan.kind === 'done'
      ? plan.outcome.world
      : plan.kind === 'solving'
        ? plan.previous?.world
        : undefined;

  const collapsed = useMemo(
    () =>
      world.groups
        .filter((g) => g.collapsed)
        .map((g) => g.id)
        .join('\u0000'),
    [world.groups],
  );
  // Factories with sub-factories drawn as one node (A53).
  const collapsedFactories = useMemo(
    () =>
      world.factories
        .filter((f) => f.collapsed)
        .map((f) => f.id)
        .join('\u0000'),
    [world.factories],
  );
  const split = (s: string) => (s ? s.split('\u0000') : []);
  const structure = useMemo(
    () =>
      summary &&
      worldGraph(summary, {
        collapsed: split(collapsed),
        collapsedFactories: split(collapsedFactories),
        itemName,
      }),
    [summary, collapsed, collapsedFactories, itemName],
  );
  const traced = useMemo(
    () =>
      summary &&
      worldGraph(summary, {
        collapsed: split(collapsed),
        collapsedFactories: split(collapsedFactories),
        itemName,
        traceItem,
      }),
    [summary, collapsed, collapsedFactories, itemName, traceItem],
  );

  const names = useNames(catalog, world);
  // A new world: nothing to plan until a factory gets a target or a link.
  const unplanned =
    world.links.length === 0 && world.factories.every((f) => f.request.targets.length === 0);
  const count = (t: Tab) =>
    t === 'Factories'
      ? world.factories.length
      : t === 'Links'
        ? world.links.length
        : t === 'Groups'
          ? world.groups.length
          : undefined;
  const fix = (f: Fix) => {
    if (f.kind === 'open-factory') onOpen(f.factory);
    else if (f.kind === 'remove-link') store.getState().removeLink(f.link);
    else if (f.kind === 'show-nodes') setTab('Nodes');
    else if (f.kind === 'edit-link') {
      const link = world.links.find((l) => l.id === f.link);
      if (link) setDraft({ from: link.from, to: link.to, link });
      setTab('Links');
    }
  };

  const actions = useMemo<CanvasActions>(
    () => ({
      openFactory: onOpen,
      setCollapsed: (id, c, nest) =>
        nest
          ? store.getState().setFactoryCollapsed(id, c)
          : store.getState().setGroupCollapsed(id, c),
      connect: (from, to) => {
        setDraft({ from, to });
        setTab('Links');
      },
    }),
    [onOpen, store],
  );

  return (
    <div className="world" aria-busy={plan.kind === 'solving'}>
      <div className="controls row toolbar">
        <label>
          Trace item
          <input
            list={traceId}
            value={traceText}
            placeholder="Pick an item…"
            onChange={(e) => {
              setTraceText(e.target.value);
              const found = items.find(e.target.value);
              if (found || e.target.value.trim() === '') setTraceId(found?.id);
            }}
          />
        </label>
        <datalist id={traceId}>
          {(summary ? traceableItems(summary) : []).map((id) => (
            <option key={id} value={itemName(id)} />
          ))}
        </datalist>
        {traceItem !== undefined && (
          <button type="button" onClick={() => setTraceItem(undefined)}>
            Clear trace
          </button>
        )}
        <button
          type="button"
          disabled={plan.kind !== 'done' || !summary?.factories.length}
          title="Save every factory's current plan as the one built in your game"
          onClick={() => {
            if (!summary) return;
            const skipped = store
              .getState()
              .markAllBuilt(summary.factories, new Date().toISOString());
            toast(
              skipped.length
                ? `Marked every factory as built except ${skipped.length} with no plan.`
                : 'Marked every factory as built.',
            );
          }}
        >
          Mark every factory as built
        </button>
        {summary && offBuildText(summary.factories) && (
          <span className="chip build-count" role="status">
            {offBuildText(summary.factories)}
          </span>
        )}
        {plan.kind === 'solving' ? (
          <SolvingNote progress={plan.progress} what="the world" />
        ) : (
          <span className="hint" role="status">
            {plan.kind === 'done' ? `World solved in ${Math.round(plan.outcome.ms)} ms.` : ''}
          </span>
        )}
      </div>
      {plan.kind === 'error' && (
        <p className="error" role="alert">
          World solve failed: {plan.message}
        </p>
      )}
      {summary && (
        <DiagnosticsList
          label="World diagnostics"
          views={worldDiagnostics(summary.diagnostics, names)}
          onFix={fix}
        />
      )}
      <div className="canvas-wrap">
        {structure && traced && (
          <ErrorBoundary what="the world canvas" resetKey={structure}>
            <WorldCanvas engine={layout} graph={structure} traced={traced} actions={actions} />
          </ErrorBoundary>
        )}
        <form
          className="canvas-overlay add-factory"
          onSubmit={(e) => {
            e.preventDefault();
            store.getState().addFactory(newName);
            setNewName('');
          }}
        >
          <input
            aria-label="New factory name"
            placeholder="New factory name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="primary">
            <PlusIcon /> Add factory
          </button>
        </form>
        {unplanned && (
          <div className="canvas-overlay canvas-hint">
            <strong>Start here.</strong> Open a factory and add a target to plan it. Drag from one
            factory’s right edge to another’s left edge to link them.
          </div>
        )}
      </div>
      {draft && (
        <LinkEditor
          key={`${draft.link?.id ?? 'new'}:${draft.from}:${draft.to}`}
          world={world}
          summary={summary}
          catalog={catalog}
          draft={draft}
          onSave={(spec, id) => {
            const s = store.getState();
            if (id === undefined) s.addLink(spec);
            else s.updateLink(id, spec);
            setDraft(undefined);
          }}
          onCancel={() => setDraft(undefined)}
        />
      )}
      <div
        className="tabs"
        role="tablist"
        aria-label="World panels"
        onKeyDown={(e) => {
          // The ARIA tab pattern: arrows move and select, Home/End jump to the ends.
          const k = TABS.indexOf(tab);
          const next =
            e.key === 'ArrowRight'
              ? (k + 1) % TABS.length
              : e.key === 'ArrowLeft'
                ? (k - 1 + TABS.length) % TABS.length
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? TABS.length - 1
                    : undefined;
          if (next === undefined) return;
          e.preventDefault();
          setTab(TABS[next]!);
          document.getElementById(`${panelId}-tab-${next}`)?.focus();
        }}
      >
        {TABS.map((t, k) => (
          <button
            key={t}
            id={`${panelId}-tab-${k}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={summary ? `${panelId}-panel` : undefined}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
          >
            {t}
            {count(t) !== undefined && (
              <>
                {' '}
                <span className="tab-count">{count(t)}</span>
              </>
            )}
          </button>
        ))}
      </div>
      {summary && (
        <section
          id={`${panelId}-panel`}
          className="summary panel"
          role="tabpanel"
          aria-label={tab}
          tabIndex={0}
        >
          {tab === 'Ledger' && (
            <LedgerPanel
              summary={summary}
              itemName={itemName}
              traceItem={traceItem}
              onTrace={setTraceItem}
            />
          )}
          {tab === 'Factories' && (
            <FactoriesPanel
              world={world}
              summary={summary}
              store={store}
              itemName={itemName}
              onOpen={onOpen}
            />
          )}
          {tab === 'Links' && (
            <LinksPanel
              world={world}
              summary={summary}
              store={store}
              itemName={itemName}
              onAdd={() => {
                const [a, b] = world.factories;
                if (a && b) setDraft({ from: a.id, to: b.id });
              }}
              onEdit={(id) => {
                const link = world.links.find((l) => l.id === id);
                if (link) setDraft({ from: link.from, to: link.to, link });
              }}
            />
          )}
          {tab === 'Power' && (
            <PowerPanel
              world={world}
              summary={summary}
              busy={plan.kind === 'solving'}
              onSizePower={onSizePower}
            />
          )}
          {tab === 'Nodes' && <NodesPanel world={world} summary={summary} catalog={catalog} />}
          {tab === 'Groups' && <GroupsPanel world={world} summary={summary} store={store} />}
        </section>
      )}
    </div>
  );
}
