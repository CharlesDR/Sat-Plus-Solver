/**
 * The app store. Its `world` is the `World` document, which is also the
 * save/share format (CLAUDE.md); M3 edits only the implicit factory's target.
 */
import type { ItemRate } from '@sps/solver';
import { createWorld, type World } from '@sps/world';
import { createStore } from 'zustand/vanilla';

export interface WorldState {
  world: World;
  /** Set when the world was made against different game data than the loaded model. */
  dataHashMismatch?: { world: string; model: string };
  /** Replaces the factory's targets with `target`, or clears them with `null`. */
  setTarget(factoryId: string, target: ItemRate | null): void;
  /** Records the loaded model's hash; a different non-empty hash is a warning, not an error. */
  attachData(dataHash: string): void;
}

export type WorldStore = ReturnType<typeof createWorldStore>;

export function createWorldStore(initial: World = createWorld()) {
  return createStore<WorldState>()((set) => ({
    world: initial,
    setTarget: (factoryId, target) =>
      set(({ world }) => {
        if (!world.factories.some((f) => f.id === factoryId))
          throw new Error(`Unknown factory "${factoryId}".`);
        return {
          world: {
            ...world,
            factories: world.factories.map((f) =>
              f.id === factoryId
                ? { ...f, request: { ...f.request, targets: target ? [{ ...target }] : [] } }
                : f,
            ),
          },
        };
      }),
    attachData: (dataHash) =>
      set(({ world }) => {
        if (world.meta.dataHash === dataHash) return {};
        if (world.meta.dataHash === '')
          return { world: { ...world, meta: { ...world.meta, dataHash } } };
        return { dataHashMismatch: { world: world.meta.dataHash, model: dataHash } };
      }),
  }));
}
