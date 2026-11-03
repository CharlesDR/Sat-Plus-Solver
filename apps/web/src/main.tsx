import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startLayoutWorker } from './flowchart/engine';
import { browserStorage, createSaves } from './persistence/saves';
import { bootWorld, startAutosave } from './persistence/session';
import { startSolverWorker } from './solver/client';
import { createWorldStore } from './store';
import { HelpTip } from './ui/HelpTip';
import { applyTheme, readTheme } from './ui/prefs';
import './styles.css';

// The saved theme applies before the first paint.
applyTheme(readTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const client = startSolverWorker();
const saves = createSaves(browserStorage());
const layout = startLayoutWorker();

// Reading a share link is async (A108), so the app renders once the world is known.
void bootWorld(window.location.hash, saves).then((boot) => {
  if (boot.source === 'link') history.replaceState(null, '', location.pathname + location.search);
  const store = createWorldStore(boot.world);
  startAutosave(store, saves);
  createRoot(root).render(
    <StrictMode>
      <App client={client} store={store} layout={layout} saves={saves} boot={boot} />
      <HelpTip />
    </StrictMode>,
  );
});
