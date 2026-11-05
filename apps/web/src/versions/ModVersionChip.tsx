/**
 * The SF+ mod version chip in the top bar (A111; variant B of the slate 7
 * mock-ups): which recipe data the world uses, and the switch to another.
 * A switch runs in the new version's worker, which drops what the version
 * lacks and solves the world; the store takes the result as one undo step.
 */
import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { SolverHub } from '../solver/hub';
import { MOD_VERSIONS, NEWEST_VERSION, solvableVersion } from '../solver/versions';
import type { WorldStore } from '../store';
import { useToast } from '../ui/toasts';
import { switchNote } from './switchNote';

/** Edits made while a switch runs are switched too: at most this many rounds. */
const ROUNDS = 3;

export function ModVersionChip({ store, hub }: { store: WorldStore; hub: SolverHub }) {
  const own = useStore(store, (s) => s.world.meta.modVersion);
  const toast = useToast();
  const [switching, setSwitching] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  /** Moves the world to `to`; resolves to a problem to show, if any. */
  const run = useCallback(
    async (to: string, why?: string): Promise<string | undefined> => {
      const client = hub.client(to);
      for (let round = 0; round < ROUNDS; round++) {
        const sent = store.getState().world;
        const o = await client.solve({
          world: sent,
          action: { kind: 'switch-version', version: to },
        });
        if (!o?.edited || !o.switched) return undefined;
        if (store.getState().world !== sent) continue;
        store.getState().replaceWorld(o.edited);
        toast(switchNote(to, o.switched, o.edited, why), {
          label: 'Undo',
          run: () => store.getState().undo(),
        });
        return undefined;
      }
      return 'The world kept changing; pick the version again.';
    },
    [hub, store, toast],
  );
  const failed = (to: string, e: unknown) =>
    `Could not switch to SF+ ${to}: ${e instanceof Error ? e.message : String(e)}`;

  const pick = async (to: string) => {
    setSwitching(to);
    setError(undefined);
    try {
      setError(await run(to));
    } catch (e) {
      setError(failed(to, e));
    } finally {
      setSwitching(undefined);
    }
  };

  // A world on a version this build lacks moves to the newest (A111).
  useEffect(() => {
    if (own === undefined || MOD_VERSIONS.includes(own)) return;
    run(NEWEST_VERSION, `This world used SF+ ${own}, which this app doesn’t have.`).then(
      setError,
      (e: unknown) => setError(failed(NEWEST_VERSION, e)),
    );
  }, [own, run]);

  return (
    <label className="scope-chip mod-version" data-help="mod-version">
      SF+{' '}
      <select
        aria-label="SF+ mod version"
        value={switching ?? solvableVersion(own)}
        disabled={switching !== undefined}
        onChange={(e) => void pick(e.target.value)}
      >
        {MOD_VERSIONS.map((v) => (
          <option key={v} value={v}>
            {v === NEWEST_VERSION ? `${v} (newest)` : v}
          </option>
        ))}
      </select>
      {error && (
        <span className="warning" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
