import { serializeWorld } from '@sps/world';
import type { WorldStore } from '../store';
import { downloadText, fileName } from './ShareControls';

/** Saves the world as a file: the recovery offered when a view crashes. */
export function ExportWorld({ store }: { store: WorldStore }) {
  return (
    <button
      type="button"
      onClick={() => downloadText(fileName('world'), serializeWorld(store.getState().world, true))}
    >
      Export world
    </button>
  );
}
