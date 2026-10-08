import type { World } from '@sps/world';
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import type { SolveOutcome, SolverClient } from './solver/client';
import type { SolveProgress, WorldAction } from './solver/protocol';

export type WorldPlanState =
  /**
   * `previous` is the last result, shown until the new one arrives;
   * `progress` is the factory the worker is on, once it has started.
   */
  | { kind: 'solving'; previous?: SolveOutcome; progress?: SolveProgress }
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
 * or a tweak's swap previews, and resolves with the outcome (`null` when a
 * newer request replaced it).
 */
export function useWorldPlan(
  client: SolverClient,
  document: World,
  focus: string | undefined,
): { state: WorldPlanState; run(action: WorldAction): Promise<SolveOutcome | null> } {
  const world = useSolvable(document);
  const [settled, setSettled] = useState<Settled | undefined>();
  // Bumped when an action's request may have replaced this hook's own.
  const [attempt, setAttempt] = useState(0);
  // Keyed by the request it belongs to, so a stale report never shows on a newer solve.
  const [heard, setHeard] = useState<{
    world: World;
    focus: string | undefined;
    p: SolveProgress;
  }>();

  useEffect(() => {
    let live = true;
    const heard = (p: SolveProgress) => {
      if (live) setHeard({ world, focus, p });
    };
    client.solve({ world, focus }, heard).then(
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
        return await client.solve({ world, focus, action });
      } finally {
        setAttempt((n) => n + 1);
      }
    },
    [client, world, focus],
  );

  const previous = settled?.outcome;
  const progress = heard?.world === world && heard.focus === focus ? heard.p : undefined;
  let state: WorldPlanState;
  if (settled?.world !== world || settled.focus !== focus)
    state = {
      kind: 'solving',
      ...(previous ? { previous } : {}),
      ...(progress ? { progress } : {}),
    };
  else if (settled.error !== undefined) state = { kind: 'error', message: settled.error };
  else state = settled.outcome ? { kind: 'done', outcome: settled.outcome } : { kind: 'solving' };
  return { state, run };
}

/**
 * The world without what only changes how a plan is drawn (a factory's
 * flowchart areas, A64), kept the same object while the rest stays the same,
 * so renaming an area or moving a box does not solve the world again.
 */
function useSolvable(world: World): World {
  const key = useMemo(
    () =>
      JSON.stringify({
        ...world,
        factories: world.factories.map((f) => {
          if (f.areas === undefined) return f;
          const rest = { ...f };
          delete rest.areas;
          return rest;
        }),
      }),
    [world],
  );
  // The world is its own save format, so it comes back from JSON whole.
  return useMemo(() => JSON.parse(key) as World, [key]);
}
