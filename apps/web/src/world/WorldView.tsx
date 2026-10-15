/**
 * The world view, the app's home (PLAN M8): the canvas, item trace, the link
 * editor and the panels.
 */
import { MW_ITEM_ID } from '@sps/data';
import { worldGraph, type LayoutEngine } from '@sps/graph';
import {
  addFactory,
  addLink,
  MINER_SUPPORT_NAME,
  unwiredMinerNeeds,
  wireMinerSupport,
  type LinkSpec,
  type World,
} from '@sps/world';
import { lazy, Suspense, useCallback, useId, useMemo, useState } from 'react';
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
import { productsOf, traceableItems, transportTiers, worldStatus } from './viewModel';
import { SHOW_TRANSPORT } from '../flags';
import { StatusChip } from '../ui/StatusChip';
import type { CanvasActions } from './WorldCanvas';
import { PlusIcon } from '../ui/icons';
import { MoreMenu } from '../ui/Menu';
import { useToast } from '../ui/toasts';
import { offBuildText } from '../build/build';

// U3: the canvas (React Flow) loads once there is a world to draw.
const WorldCanvas = lazy(() => import('./WorldCanvas').then((m) => ({ default: m.WorldCanvas })));

const TABS = ['Ledger', 'Factories', 'Links', 'Power', 'Nodes', 'Groups'] as const;
type Tab = (typeof TABS)[number];

/** What the empty-world start screen offers besides opening a factory (N7). */
export interface StartActions {
  sample(): void;
  importFile(): void;
}

/** A link dropped on empty canvas (see `CanvasActions.dropOnPane`), waiting for a factory name. */
type Drop = { factory: string; side: 'in' | 'out'; item?: string };

/** Whether the world panels were open when the world view was last shown. */
let panelWasOpen = false;

export function WorldView(props: {
  world: World;
  store: WorldStore;
  catalog: Catalog;
  layout: LayoutEngine;
  plan: WorldPlanState;
  onOpen(factoryId: string): void;
  onSizePower(factoryId: string): void;
  start: StartActions;
}) {
  const { world, store, catalog, layout, plan, onOpen, onSizePower, start } = props;
  // The panels start collapsed to the tab row, so the canvas gets the height;
  // picking a tab opens them, and they stay as left for this page visit (UX-A).
  const [tab, pickTab] = useState<Tab>('Factories');
  const [panelOpen, openPanel] = useState(() => panelWasOpen);
  const setPanelOpen = useCallback((open: boolean) => {
    panelWasOpen = open;
    openPanel(open);
  }, []);
  const setTab = useCallback(
    (t: Tab) => {
      pickTab(t);
      setPanelOpen(true);
    },
    [setPanelOpen],
  );
  const [traceItem, setTraceId] = useState<string>();
  const [traceText, setTraceText] = useState('');
  const [draft, setDraft] = useState<LinkDraft>();
  const [newName, setNewName] = useState('');
  const [drop, setDrop] = useState<Drop>();
  const [dropName, setDropName] = useState('');
  // The link a canvas drag just made, marked in the Links tab.
  const [drawn, setDrawn] = useState<string>();
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
  // Miner fluid supplied from outside (A69) that no Miner support link brings in yet (A71).
  const unwired = summary ? unwiredMinerNeeds(world, summary).length : 0;
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

  /** A drawn link's spec: pull, on belts or pipes when transport shows. */
  const quickSpec = useCallback(
    (from: string, to: string, item: string): LinkSpec => {
      const kind = catalog.fluids.includes(item) ? 'pipe' : 'belt';
      const tier = transportTiers(catalog, kind)[0]?.tier;
      return {
        from,
        to,
        item,
        mode: { kind: 'pull' },
        ...(SHOW_TRANSPORT ? { transport: tier !== undefined ? { kind, tier } : { kind } } : {}),
      };
    },
    [catalog],
  );
  /** The part a drag carries: its port's, or the source's only product. */
  const dragPart = useCallback(
    (from: string, item: string | undefined) => {
      if (item !== undefined) return item;
      const products = productsOf(summary, from);
      return products.length === 1 ? products[0] : undefined;
    },
    [summary],
  );

  const actions = useMemo<CanvasActions>(
    () => ({
      openFactory: onOpen,
      setCollapsed: (id, c, nest) =>
        nest
          ? store.getState().setFactoryCollapsed(id, c)
          : store.getState().setGroupCollapsed(id, c),
      // A drag that knows its part makes the link at once (Pull); otherwise the form opens.
      connect: (from, to, item) => {
        const part = dragPart(from, item);
        if (part === undefined) {
          setDraft({ from, to });
          setDrawn(undefined);
          return;
        }
        try {
          setDrawn(store.getState().addLink(quickSpec(from, to, part)));
          setDraft(undefined);
          setTab('Links');
        } catch (e) {
          toast((e as Error).message);
        }
      },
      dropOnPane: (factory, side, item) => {
        setDropName('');
        setDrop({
          factory,
          side,
          ...(side === 'out' && dragPart(factory, item) !== undefined
            ? { item: dragPart(factory, item)! }
            : item !== undefined
              ? { item }
              : {}),
        });
      },
    }),
    [onOpen, store, setTab, dragPart, quickSpec, toast],
  );
  /** Makes the dropped link's new factory, with the link in place when its part is known. */
  const createDropped = () => {
    if (!drop) return;
    try {
      const made = addFactory(world, dropName);
      const [from, to] = drop.side === 'out' ? [drop.factory, made.id] : [made.id, drop.factory];
      if (drop.item === undefined) {
        store.getState().replaceWorld(made.world);
        setDraft({ from, to });
      } else {
        const linked = addLink(made.world, quickSpec(from, to, drop.item));
        store.getState().replaceWorld(linked.world);
        setDrawn(linked.id);
        setTab('Links');
      }
      setDrop(undefined);
    } catch (e) {
      toast((e as Error).message);
    }
  };

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
        {unwired > 0 && summary && (
          <button
            type="button"
            title="Make the miner fluid that factories get supplied from outside, in one factory linked to each"
            onClick={() => {
              const out = wireMinerSupport(world, summary);
              store.getState().replaceWorld(out.world);
              toast(
                `Linked ${out.links.length} miner ${out.links.length === 1 ? 'fluid' : 'fluids'} from ${MINER_SUPPORT_NAME}.`,
              );
            }}
          >
            {world.factories.some((f) => f.name === MINER_SUPPORT_NAME && !f.parentId)
              ? `Link ${MINER_SUPPORT_NAME} (${unwired})`
              : `Add ${MINER_SUPPORT_NAME} factory`}
          </button>
        )}
        {summary && (
          <span data-testid="world-status" title="World status">
            <StatusChip {...worldStatus(summary)} />
          </span>
        )}
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
        {/* Power actions sit in a menu, not in prime position (UX-10). */}
        <MoreMenu label="More world actions" className="world-more">
          <div className="menu-actions">
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
          </div>
        </MoreMenu>
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
      {/* Docked above the canvas, not floating over its nodes (B3); the one Add entry (UX-8). */}
      <div className="canvas-head">
        <form
          className="add-factory"
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
      </div>
      <div className="canvas-wrap">
        {structure && traced && (
          <ErrorBoundary what="the world canvas" resetKey={structure}>
            <Suspense fallback={null}>
              <WorldCanvas engine={layout} graph={structure} traced={traced} actions={actions} />
            </Suspense>
          </ErrorBoundary>
        )}
        {drop && (
          <form
            className="canvas-overlay drop-prompt pane-in"
            aria-label="New factory for this link"
            onSubmit={(e) => {
              e.preventDefault();
              createDropped();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDrop(undefined);
            }}
          >
            <p>
              New factory {drop.side === 'out' ? 'taking' : 'making'}{' '}
              {drop.item !== undefined ? itemName(drop.item) : 'a part'}{' '}
              {drop.side === 'out' ? 'from' : 'for'}{' '}
              {world.factories.find((f) => f.id === drop.factory)?.name}
            </p>
            <input
              aria-label="Factory name"
              placeholder={`Factory ${world.factories.length + 1}`}
              value={dropName}
              autoFocus
              onChange={(e) => setDropName(e.target.value)}
            />
            <div className="row">
              <button type="submit" className="primary">
                Create factory
              </button>
              <button type="button" onClick={() => setDrop(undefined)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {unplanned && !drop && (
          <div
            // Centred on an empty canvas; beside the cards once there are some.
            className={`canvas-overlay canvas-hint${world.factories.length ? '' : ' centred'}`}
            role="group"
            aria-label="Start here"
          >
            <p>
              <strong>Start here.</strong>{' '}
              {world.factories.length === 0
                ? 'Create a factory, then pick what it makes.'
                : 'Open a factory and add a target to plan it.'}{' '}
              Drag from one factory’s right edge to another’s left edge to link them.
            </p>
            <div className="start-cards">
              <button
                type="button"
                onClick={() => {
                  const id = store.getState().addFactory(newName);
                  setNewName('');
                  onOpen(id);
                }}
              >
                <strong>Create a factory</strong>
                <span>Add one and pick what it makes.</span>
              </button>
              <button type="button" onClick={start.sample}>
                <strong>Open the sample world</strong>
                <span>Four linked factories.</span>
              </button>
              <button type="button" onClick={start.importFile}>
                <strong>Import a file</strong>
                <span>A world (.json) or Modeler (.sfmd) file.</span>
              </button>
            </div>
          </div>
        )}
      </div>
      {draft && (
        <LinkEditor
          key={`${draft.link?.id ?? 'new'}:${draft.from}:${draft.to}:${draft.item ?? ''}`}
          world={world}
          summary={summary}
          catalog={catalog}
          draft={draft}
          onSave={(spec, id) => {
            const s = store.getState();
            if (id === undefined) {
              setDrawn(s.addLink(spec));
              setTab('Links');
            } else s.updateLink(id, spec);
            setDraft(undefined);
          }}
          onCancel={() => setDraft(undefined)}
        />
      )}
      <div className="tabs-row">
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
              aria-controls={summary && panelOpen ? `${panelId}-panel` : undefined}
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
        {panelOpen && (
          <button
            type="button"
            className="link-button tabs-collapse"
            aria-expanded="true"
            onClick={() => setPanelOpen(false)}
          >
            Hide panel
          </button>
        )}
      </div>
      {summary && panelOpen && (
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
              highlight={drawn}
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
