import type { World } from '@sps/world';
import { startTransition, useCallback, useEffect, useState } from 'react';
import type { SolveOutcome, SolverClient } from './solver/client';
import type { WorldAction } from './solver/protocol';

export type WorldPlanState =
  /** `previous` is the last result, shown until the new one arrives. */
  | { kind: 'solving'; previous?: SolveOutcome }
  | { kind: 'done'; outcome: SolveOutcome }
  | { kind: 'error'; message: string };

interface Settled {
  world: World;
  focus: string | undefined;
  outcome?: SolveOutcome;
  error?: string;
}

/**
 * Solves the world in the worker whenever the document (or the focused
 * factory) changes. `run` sends a world action, such as "size power plant",
 * and resolves with the edited world it returns.
 */
export function useWorldPlan(
  client: SolverClient,
  world: World,
  focus: string | undefined,
): { state: WorldPlanState; run(action: WorldAction): Promise<World | undefined> } {
  const [settled, setSettled] = useState<Settled | undefined>();
  // Bumped when an action's request may have replaced this hook's own.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    client.solve({ world, focus }).then(
      // A transition lets React render a large result in slices instead of one long task.
      (outcome) => {
        if (live && outcome) startTransition(() => setSettled({ world, focus, outcome }));
      },
      (e: unknown) => {
        if (live) startTransition(() => setSettled({ world, focus, error: (e as Error).message }));
      },
    );
    return () => {
      live = false;
    };
  }, [client, world, focus, attempt]);

  const run = useCallback(
    async (action: WorldAction) => {
      try {
        const outcome = await client.solve({ world, focus, action });
        return outcome?.edited;
      } finally {
        setAttempt((n) => n + 1);
      }
    },
    [client, world, focus],
  );

  const previous = settled?.outcome;
  let state: WorldPlanState;
  if (settled?.world !== world || settled.focus !== focus)
    state = previous ? { kind: 'solving', previous } : { kind: 'solving' };
  else if (settled.error !== undefined) state = { kind: 'error', message: settled.error };
  else state = settled.outcome ? { kind: 'done', outcome: settled.outcome } : { kind: 'solving' };
  return { state, run };
}
