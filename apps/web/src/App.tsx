import type { LayoutEngine } from '@sps/graph';
import { DEFAULT_FACTORY_ID } from '@sps/world';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { ImportsEditor } from './controls/ImportsEditor';
import { NodeBudgetEditor } from './controls/NodeBudgetEditor';
import { RecipeToggles } from './controls/RecipeToggles';
import { SettingsPanel } from './controls/SettingsPanel';
import { TargetsEditor } from './controls/TargetsEditor';
import { Flowchart } from './flowchart/Flowchart';
import type { Selection } from './selection';
import type { SolverClient } from './solver/client';
import type { Catalog } from './solver/protocol';
import type { Scope, WorldStore } from './store';
import { SummaryTable } from './SummaryTable';
import type { SolveOutcome } from './solver/client';
import { usePlan, type PlanState } from './usePlan';

const FACTORY = DEFAULT_FACTORY_ID;

export function App(props: { client: SolverClient; store: WorldStore; layout: LayoutEngine }) {
  const { client, store, layout } = props;
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
      {initError ? (
        <p className="error" role="alert">
          The solver failed to start: {initError}
        </p>
      ) : !catalog ? (
        <p aria-busy="true">Loading the solver…</p>
      ) : (
        <FactoryView
          client={client}
          store={store}
          layout={layout}
          catalog={catalog}
          factoryId={FACTORY}
        />
      )}
    </main>
  );
}

/** One factory: its controls (M6) and its plan. */
function FactoryView(props: {
  client: SolverClient;
  store: WorldStore;
  layout: LayoutEngine;
  catalog: Catalog;
  factoryId: string;
}) {
  const { client, store, layout, catalog, factoryId } = props;
  const [selection, setSelection] = useState<Selection>();
  const world = useStore(store, (s) => s.world);
  const actions = store.getState();
  const factory = world.factories.find((f) => f.id === factoryId);
  const [scopeKind, setScopeKind] = useState<Scope['kind']>('factory');
  const scope = useMemo<Scope>(
    () => (scopeKind === 'world' ? { kind: 'world' } : { kind: 'factory', id: factoryId }),
    [scopeKind, factoryId],
  );
  const plan = usePlan(client, world, factoryId);
  const outcome =
    plan.kind === 'done' ? plan.outcome : plan.kind === 'solving' ? plan.previous : undefined;
  const usage = useMemo(
    () => new Map(outcome?.plan.nodes.map((n) => [n.node, n.used]) ?? []),
    [outcome],
  );
  if (!factory) return <p className="error">Unknown factory “{factoryId}”.</p>;

  return (
    <div className="factory">
      <section className="controls" aria-label="Factory controls">
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
          <summary>
            Node budget ({factory.nodeBudget === 'pool' ? 'whole map pool' : 'explicit caps'})
          </summary>
          <NodeBudgetEditor
            world={world}
            factory={factory}
            nodes={catalog.nodes}
            usage={usage}
            onChange={(b) => actions.setNodeBudget(factoryId, b)}
          />
        </details>
      </section>
      <PlanView
        plan={plan}
        layout={layout}
        selection={selection}
        onSelect={(id, from) => setSelection(id === undefined ? undefined : { id, from })}
      />
    </div>
  );
}

function PlanView(props: {
  plan: PlanState;
  layout: LayoutEngine;
  selection: Selection | undefined;
  onSelect: (id: string | undefined, from: Selection['from']) => void;
}) {
  const { plan, layout, selection, onSelect } = props;
  const solved = (o: SolveOutcome) => (
    <>
      <Flowchart
        engine={layout}
        graph={o.graph}
        selection={selection}
        onSelect={(id) => onSelect(id, 'graph')}
      />
      <SummaryTable plan={o.plan} selection={selection} onSelect={(id) => onSelect(id, 'table')} />
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
          <p className="solving">Solving…</p>
          {plan.previous && <div className="stale">{solved(plan.previous)}</div>}
        </div>
      );
    case 'done':
      return (
        <div aria-busy="false" data-testid="plan">
          <p className="timing">Solved in {Math.round(plan.outcome.ms)} ms.</p>
          {solved(plan.outcome)}
        </div>
      );
  }
}
