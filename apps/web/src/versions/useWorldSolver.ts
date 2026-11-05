import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { SolverHub } from '../solver/hub';
import type { Catalog } from '../solver/protocol';
import { solvableVersion } from '../solver/versions';
import type { WorldStore } from '../store';

/**
 * The solver for the open world's SF+ mod version (A111) and its catalog.
 * The other versions' workers stop once the world has moved; until the new
 * version's catalog arrives, the last one stays on screen.
 */
export function useWorldSolver(hub: SolverHub, store: WorldStore) {
  const version = solvableVersion(useStore(store, (s) => s.world.meta.modVersion));
  const client = useMemo(() => hub.client(version), [hub, version]);
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [initError, setInitError] = useState<string | undefined>();
  useEffect(() => hub.keepOnly(version), [hub, version]);
  useEffect(() => {
    let live = true;
    client.ready.then(
      (r) => {
        if (!live) return;
        store.getState().attachData(r.dataHash, version);
        setCatalog(r.catalog);
        setInitError(undefined);
      },
      (e: unknown) => {
        if (live) setInitError((e as Error).message);
      },
    );
    return () => {
      live = false;
    };
  }, [client, store, version]);
  return { client, catalog, initError };
}
