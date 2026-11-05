/**
 * SF+ mod versions (A111): each has its own dataset in mod-versions/<version>/
 * and its own model in data/generated/<version>/.
 */

/** Orders mod versions by their numbers: "2026.3.489" < "2026.4.651" < "2026.10.1". */
export function compareModVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
