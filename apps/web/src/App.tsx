import { DEFAULT_FACTORY_ID } from '@sps/world';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { SolverClient } from './solver/client';
import type { CatalogItem } from './solver/protocol';
import type { WorldStore } from './store';
import { SummaryTable } from './SummaryTable';
import { TargetPicker } from './TargetPicker';
import { usePlan } from './usePlan';

const FACTORY = DEFAULT_FACTORY_ID;

export function App({ client, store }: { client: SolverClient; store: WorldStore }) {
  const world = useStore(store, (s) => s.world);
  const mismatch = useStore(store, (s) => s.dataHashMismatch);
  const setTarget = useStore(store, (s) => s.setTarget);
  const [catalog, setCatalog] = useState<CatalogItem[] | undefined>();
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

  const plan = usePlan(client, world, FACTORY);
  const target = world.factories.find((f) => f.id === FACTORY)?.request.targets[0];

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
        <>
          <TargetPicker catalog={catalog} target={target} onChange={(t) => setTarget(FACTORY, t)} />
          <PlanView plan={plan} />
        </>
      )}
    </main>
  );
}

function PlanView({ plan }: { plan: ReturnType<typeof usePlan> }) {
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
          {plan.previous && (
            <div className="stale">
              <SummaryTable plan={plan.previous.plan} />
            </div>
          )}
        </div>
      );
    case 'done':
      return (
        <div aria-busy="false" data-testid="plan">
          <p className="timing">Solved in {Math.round(plan.outcome.ms)} ms.</p>
          <SummaryTable plan={plan.outcome.plan} />
        </div>
      );
  }
}
