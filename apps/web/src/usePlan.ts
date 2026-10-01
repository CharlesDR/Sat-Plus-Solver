import type { World } from '@sps/world';
import { useEffect, useState } from 'react';
import type { SolveOutcome, SolverClient } from './solver/client';

export type PlanState =
  | { kind: 'idle' }
  /** `previous` is the last plan, shown until the new one arrives. */
  | { kind: 'solving'; previous?: SolveOutcome }
  | { kind: 'done'; outcome: SolveOutcome }
  | { kind: 'error'; message: string };

interface Settled {
  world: World;
  outcome?: SolveOutcome;
  error?: string;
}

/** Solves the factory in the worker whenever the world document changes. */
export function usePlan(client: SolverClient, world: World, factoryId: string): PlanState {
  const [settled, setSettled] = useState<Settled | undefined>();
  const hasTargets =
    (world.factories.find((f) => f.id === factoryId)?.request.targets.length ?? 0) > 0;

  useEffect(() => {
    if (!hasTargets) return;
    let live = true;
    client.solve(world, factoryId).then(
      (outcome) => {
        if (live && outcome) setSettled({ world, outcome });
      },
      (e: unknown) => {
        if (live) setSettled({ world, error: (e as Error).message });
      },
    );
    return () => {
      live = false;
    };
  }, [client, world, factoryId, hasTargets]);

  if (!hasTargets) return { kind: 'idle' };
  if (settled?.world !== world)
    return settled?.outcome ? { kind: 'solving', previous: settled.outcome } : { kind: 'solving' };
  if (settled.error !== undefined) return { kind: 'error', message: settled.error };
  return settled.outcome ? { kind: 'done', outcome: settled.outcome } : { kind: 'solving' };
}
