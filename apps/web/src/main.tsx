import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startLayoutWorker } from './flowchart/engine';
import { browserStorage, createSaves } from './persistence/saves';
import { randomWorldId } from './persistence/copies';
import { bootWorld, readLink, startAutosave } from './persistence/session';
import { startSolverWorker } from './solver/client';
import { createSolverHub } from './solver/hub';
import { NEWEST_VERSION } from './solver/versions';
import { createWorldStore } from './store';
import { HelpTip } from './ui/HelpTip';
import { applyTheme, readTheme } from './ui/prefs';
import './styles.css';

// The saved theme applies before the first paint.
applyTheme(readTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// One solver worker per SF+ mod version, started for the world's own (A111).
const hub = createSolverHub(startSolverWorker);
const saves = createSaves(browserStorage());
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
      <App hub={hub} store={store} layout={layout} saves={saves} boot={boot} />
      <HelpTip />
    </StrictMode>,
  );
});
