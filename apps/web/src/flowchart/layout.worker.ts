/**
 * Layout worker: runs the ELK engine off the main thread. Importing the
 * engine inside a worker makes it answer the `elkjs` API's messages itself.
 */
import 'elkjs/lib/elk-worker.min.js';
