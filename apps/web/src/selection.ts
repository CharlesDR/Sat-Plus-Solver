/**
 * The flowchart node picked in the flowchart or the plan table (M7). The id
 * is a flowchart node id (`recipe:<id>`, `import:<item>`, …); `from` says
 * where it was picked, so only the other view scrolls to it.
 */
export interface Selection {
  id: string;
  from: 'graph' | 'table';
}
