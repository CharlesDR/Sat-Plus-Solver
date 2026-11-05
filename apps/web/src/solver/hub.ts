/**
 * One solver worker per SF+ mod version (A111). The app solves the open
 * world on its version's client; a version switch starts the other one, and
 * the old one stops once the world has moved.
 */
import type { SolverClient } from './client';

export interface SolverHub {
  /** The version's client, started on first use. */
  client(version: string): SolverClient;
  /** Stops every client but the version's. */
  keepOnly(version: string): void;
}

export function createSolverHub(start: (version: string) => SolverClient): SolverHub {
  const clients = new Map<string, SolverClient>();
  return {
    client(version) {
      let c = clients.get(version);
      if (!c) clients.set(version, (c = start(version)));
      return c;
    },
    keepOnly(version) {
      for (const [v, c] of clients)
        if (v !== version) {
          c.dispose();
          clients.delete(v);
        }
    },
  };
}
