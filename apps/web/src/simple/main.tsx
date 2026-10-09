import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startLayoutWorker } from '../flowchart/engine';
import { browserStorage, createSaves, SIMPLE_PREFIX } from '../persistence/saves';
import { bootWorld, startAutosave } from '../persistence/session';
import { startSolverWorker } from '../solver/client';
import { createWorldStore } from '../store';
import { applyTheme, readTheme } from '../ui/prefs';
import { SimpleApp } from './SimpleApp';
import '../styles.css';

// The saved theme applies before the first paint; it is shared with the full planner.
applyTheme(readTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const client = startSolverWorker();
// Simple mode's own autosave, backup and slots (A72), apart from the full planner's.
const saves = createSaves(browserStorage(), Date.now, SIMPLE_PREFIX);
const boot = bootWorld(window.location.hash, saves);
if (boot.source === 'link') history.replaceState(null, '', location.pathname + location.search);
const store = createWorldStore(boot.world);
startAutosave(store, saves);
const layout = startLayoutWorker();

createRoot(root).render(
  <StrictMode>
    <SimpleApp client={client} store={store} layout={layout} saves={saves} boot={boot} />
  </StrictMode>,
);
