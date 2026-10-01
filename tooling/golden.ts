/**
 * Golden harness (docs/ARCHITECTURE.md §9): each `fixtures/golden/*.json`
 * holds a request and the plan satisfactory-tools gives for it. Machine
 * counts, imports, surplus, objective and power must match within 1e-6 relative.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Model } from '@sps/data';
import type { SolveRequest, SolveResult } from '@sps/solver';
import { ROOT } from './build-data';

export interface GoldenCase {
  name: string;
  description: string;
  model: 'vanilla-mini';
  /** As SolveRequest, except an import `cap` of null means unlimited (JSON has no Infinity). */
  request: SolveRequest;
  expected: {
    status: SolveResult['status'];
    recipes: Record<string, number>;
    imports: Record<string, number>;
    surplus: Record<string, number>;
    objectiveValue?: number;
    power?: SolveResult['power'];
  };
}

export const GOLDEN_DIR = join(ROOT, 'fixtures', 'golden');
export const REL_TOL = 1e-6;

export function loadVanillaMini(): Model {
  return JSON.parse(readFileSync(join(ROOT, 'fixtures', 'vanilla-mini', 'model.json'), 'utf8'));
}

export function loadGoldenCases(dir = GOLDEN_DIR): GoldenCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as GoldenCase;
      const imports = c.request.imports?.map((i) => ({ ...i, cap: i.cap ?? Infinity }));
      return { ...c, request: { ...c.request, ...(imports ? { imports } : {}) } };
    });
}

const close = (a: number, b: number) =>
  Math.abs(a - b) <= REL_TOL * Math.max(Math.abs(a), Math.abs(b), 1e-12);

/** Lists every difference between a result and the golden expectation; empty when it matches. */
export function compareGolden(c: GoldenCase, r: SolveResult): string[] {
  const diffs: string[] = [];
  if (r.status !== c.expected.status) diffs.push(`status ${r.status} ≠ ${c.expected.status}`);
  const map = (label: string, actual: Record<string, number>, expected: Record<string, number>) => {
    for (const k of [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()) {
      const a = actual[k] ?? 0;
      const e = expected[k] ?? 0;
      if (!close(a, e)) diffs.push(`${label} ${k}: got ${a}, expected ${e}`);
    }
  };
  map('recipe', Object.fromEntries(r.recipes.map((x) => [x.id, x.machines])), c.expected.recipes);
  map('import', Object.fromEntries(r.imports.map((x) => [x.item, x.rate])), c.expected.imports);
  map('surplus', Object.fromEntries(r.surplus.map((x) => [x.item, x.rate])), c.expected.surplus);
  if (
    c.expected.objectiveValue !== undefined &&
    !close(r.objectiveValue ?? NaN, c.expected.objectiveValue)
  )
    diffs.push(`objective: got ${r.objectiveValue}, expected ${c.expected.objectiveValue}`);
  if (c.expected.power) map('power', { ...r.power }, { ...c.expected.power });
  return diffs;
}
