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

/** Side of the item icon drawn in every flowchart node, in px (A38). */
export const ICON_SIZE = 32;
/** Side of the item icon before the rate in line labels and tray rows (A48). */
export const LABEL_ICON_SIZE = 16;

/**
 * Lays the graph out in the layout worker whenever it, or the number format
 * that sizes its text (UX-6), changes.
 */
export function useLayout(
  engine: LayoutEngine,
  graph: FactoryGraph,
  rate: (n: number) => string,
): LayoutState {
  const [settled, setSettled] = useState<{
    graph: FactoryGraph;
    rate: (n: number) => string;
    state: LayoutState;
  }>();
  useEffect(() => {
    let live = true;
    layoutFactoryGraph(graph, engine, {
      iconSize: ICON_SIZE,
      labelIconSize: LABEL_ICON_SIZE,
      rate,
    }).then(
      (layout) => {
        if (live)
          startTransition(() => setSettled({ graph, rate, state: { kind: 'done', layout } }));
      },
      (e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        if (live)
          startTransition(() => setSettled({ graph, rate, state: { kind: 'error', message } }));
      },
    );
    return () => {
      live = false;
    };
  }, [engine, graph, rate]);
  return settled?.graph === graph && settled.rate === rate ? settled.state : { kind: 'pending' };
}
