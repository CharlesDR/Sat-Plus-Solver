import type { Issues } from './issues';
import { parseRational, type Rational } from './rational';

/** One row of data/nodes.csv: map-wide node counts for a resource. */
export interface NodeRow {
  resource: string;
  sites: number;
  impure: number;
  normal: number;
  pure: number;
  /** Optional per-site rate override (m³/min) for fracking sites (A6). */
  siteRate?: Rational;
}

const HEADER = ['resource', 'fracking_sites', 'impure', 'normal', 'pure', 'site_rate_m3_min'];

export function parseNodesCsv(text: string, issues: Issues): NodeRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const header = lines.shift()?.split(',');
  if (!header || header.join(',') !== HEADER.join(',')) {
    issues.error('nodes.header', `data/nodes.csv header must be "${HEADER.join(',')}"`);
    return [];
  }
  const rows: NodeRow[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const where = `data/nodes.csv line ${i + 2}`;
    if (line.includes('"')) {
      issues.error('nodes.quoted', `${where}: quoted fields are not supported`);
      return;
    }
    const cells = line.split(',');
    if (cells.length !== HEADER.length) {
      issues.error('nodes.columns', `${where}: expected ${HEADER.length} columns`);
      return;
    }
    const [resource, ...rest] = cells as [string, ...string[]];
    const counts = rest.slice(0, 4).map((c) => (c === '' ? 0 : Number(c)));
    if (counts.some((c) => !Number.isInteger(c) || c < 0)) {
      issues.error('nodes.count', `${where}: counts must be non-negative integers`);
      return;
    }
    if (seen.has(resource)) {
      issues.error('nodes.duplicate', `${where}: duplicate resource "${resource}"`);
      return;
    }
    seen.add(resource);
    const [sites, impure, normal, pure] = counts as [number, number, number, number];
    const row: NodeRow = { resource, sites, impure, normal, pure };
    const rateText = rest[4] ?? '';
    if (rateText !== '') {
      const rate = parseRational(rateText);
      if (!rate || rate.n <= 0n) {
        issues.error('nodes.siteRate', `${where}: site_rate_m3_min must be a positive number`);
        return;
      }
      row.siteRate = rate;
    }
    rows.push(row);
  });
  return rows;
}
