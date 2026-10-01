/**
 * The world view, the app's home (PLAN M8): the canvas, item trace, the link
 * editor and the panels.
 */
import { MW_ITEM_ID } from '@sps/data';
import { worldGraph, type LayoutEngine } from '@sps/graph';
import type { World } from '@sps/world';
import { useCallback, useId, useMemo, useState } from 'react';
import { useItemLookup } from '../controls/itemRows';
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
  const traceId = useId();
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
  const structure = useMemo(
    () =>
      summary &&
      worldGraph(summary, { collapsed: collapsed ? collapsed.split('\u0000') : [], itemName }),
    [summary, collapsed, itemName],
  );
  const traced = useMemo(
    () =>
      summary &&
      worldGraph(summary, {
        collapsed: collapsed ? collapsed.split('\u0000') : [],
        itemName,
        traceItem,
      }),
    [summary, collapsed, itemName, traceItem],
  );

  const actions = useMemo<CanvasActions>(
    () => ({
      openFactory: onOpen,
      setCollapsed: (id, c) => store.getState().setGroupCollapsed(id, c),
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
        <span className="hint">
          {plan.kind === 'solving'
            ? 'Solving the world…'
            : plan.kind === 'done'
              ? `World solved in ${Math.round(plan.outcome.ms)} ms.`
              : ''}
        </span>
      </div>
      {plan.kind === 'error' && (
        <p className="error" role="alert">
          World solve failed: {plan.message}
        </p>
      )}
      {summary && summary.diagnostics.length > 0 && (
        <ul className="diagnostics" aria-label="World diagnostics">
          {summary.diagnostics.map((d, k) => (
            <li key={k} className={d.severity}>
              {d.severity}: {d.message}
            </li>
          ))}
        </ul>
      )}
      {structure && traced && (
        <WorldCanvas engine={layout} graph={structure} traced={traced} actions={actions} />
      )}
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
      <div className="tabs" role="tablist" aria-label="World panels">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {summary && (
        <section className="summary panel" role="tabpanel" aria-label={tab}>
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
