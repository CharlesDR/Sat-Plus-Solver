import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startLayoutWorker } from '../flowchart/engine';
import { browserStorage, createSaves, SIMPLE_PREFIX } from '../persistence/saves';
import { randomWorldId } from '../persistence/copies';
import { bootWorld, readLink, startAutosave } from '../persistence/session';
import { startSolverWorker } from '../solver/client';
import { createSolverHub } from '../solver/hub';
import { NEWEST_VERSION } from '../solver/versions';
import { createWorldStore } from '../store';
import { applyTheme, readTheme } from '../ui/prefs';
import { SimpleApp } from './SimpleApp';
import '../styles.css';

// The saved theme applies before the first paint; it is shared with the full planner.
applyTheme(readTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// One solver worker per SF+ mod version, started for the world's own (A111).
const hub = createSolverHub(startSolverWorker);
// Simple mode's own autosave, backup and slots (A72), apart from the full planner's.
const saves = createSaves(browserStorage(), Date.now, SIMPLE_PREFIX);
const layout = startLayoutWorker();

// Reading a share link is async (A108), so the app renders once the world is known.
void bootWorld(window.location.hash, saves).then((boot) => {
  if (readLink(boot)) history.replaceState(null, '', location.pathname + location.search);
  // Each world gets an id once, so its copies on other computers can be recognised (A109);
  // a new world starts on the newest mod version (A111).
  const store = createWorldStore(boot.world, {
    newWorldId: randomWorldId,
    newestVersion: NEWEST_VERSION,
  });
  startAutosave(store, saves);
  createRoot(root).render(
    <StrictMode>
      <SimpleApp hub={hub} store={store} layout={layout} saves={saves} boot={boot} />
    </StrictMode>,
  );
});
