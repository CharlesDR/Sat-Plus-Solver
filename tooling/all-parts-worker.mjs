// Worker entry for all-parts.ts: tsx's loader hooks don't reach worker
// threads, so the worker registers them before loading the TypeScript.
import { register } from 'tsx/esm/api';

register();
await import('./all-parts.ts');
