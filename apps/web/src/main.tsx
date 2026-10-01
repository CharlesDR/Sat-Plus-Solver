import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startLayoutWorker } from './flowchart/engine';
import { startSolverWorker } from './solver/client';
import { createWorldStore } from './store';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const client = startSolverWorker();
const store = createWorldStore();
const layout = startLayoutWorker();

createRoot(root).render(
  <StrictMode>
    <App client={client} store={store} layout={layout} />
  </StrictMode>,
);
