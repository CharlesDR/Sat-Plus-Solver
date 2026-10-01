import {
  layoutFactoryGraph,
  type FactoryGraph,
  type FactoryLayout,
  type LayoutEngine,
} from '@sps/graph';
import { startTransition, useEffect, useState } from 'react';

export type LayoutState =
  | { kind: 'pending' }
  | { kind: 'done'; layout: FactoryLayout }
  | { kind: 'error'; message: string };

/** Lays the graph out in the layout worker whenever it changes. */
export function useLayout(engine: LayoutEngine, graph: FactoryGraph): LayoutState {
  const [settled, setSettled] = useState<{ graph: FactoryGraph; state: LayoutState }>();
  useEffect(() => {
    let live = true;
    layoutFactoryGraph(graph, engine).then(
      (layout) => {
        if (live) startTransition(() => setSettled({ graph, state: { kind: 'done', layout } }));
      },
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        if (live) startTransition(() => setSettled({ graph, state: { kind: 'error', message } }));
      },
    );
    return () => {
      live = false;
    };
  }, [engine, graph]);
  return settled?.graph === graph ? settled.state : { kind: 'pending' };
}
