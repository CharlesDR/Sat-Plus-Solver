/** Messages between the main thread and the solver worker. */
import type { PlanSummary } from '@sps/solver';
import type { World } from '@sps/world';

/** An item the target picker offers. */
export interface CatalogItem {
  id: string;
  name: string;
}

export type ToWorker = { type: 'solve'; id: number; world: World; factoryId: string };

export type FromWorker =
  | { type: 'ready'; catalog: CatalogItem[]; dataHash: string }
  | { type: 'init-error'; message: string }
  | { type: 'solved'; id: number; plan: PlanSummary; ms: number }
  | { type: 'failed'; id: number; message: string };
