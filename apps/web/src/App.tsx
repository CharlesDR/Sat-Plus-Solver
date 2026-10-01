import { MODEL_SCHEMA_VERSION } from '@sps/data';
import { PACKAGE_NAME as WORLD } from '@sps/world';

export function App() {
  return (
    <main>
      <h1>Sat-Plus-Solver</h1>
      <p>
        Scaffold only. Model schema v{MODEL_SCHEMA_VERSION}; wired packages: {WORLD}.
      </p>
    </main>
  );
}
