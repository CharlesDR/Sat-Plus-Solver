/**
 * Cache keys for per-factory solves (§4.3 step 5): a canonical JSON form of
 * the effective request and a 64-bit FNV-1a hash of it. Pure and browser-safe.
 */
import type { SolveRequest, SolveResult } from '@sps/solver';

/**
 * JSON with sorted object keys, so equal values give equal strings. Numbers
 * JSON can't carry (`Infinity`, `NaN`) are written as strings.
 */
export function stableStringify(value: unknown): string {
  if (typeof value === 'number')
    return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

/** 64-bit FNV-1a over the UTF-16 code units of `s`, as 16 hex digits. */
export function hashString(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK;
  }
  return h.toString(16).padStart(16, '0');
}

/** Memoized factory solves: hash → canonical request and its result. */
export type SolveCache = Map<string, { canonical: string; result: SolveResult }>;

export function createSolveCache(): SolveCache {
  return new Map();
}

/**
 * Canonical form and key of one factory solve: `hash(modelHash, effectiveRequest)`.
 * The effective request already holds the resolved link rates (as demand and
 * import caps) and the node budget, so the key covers all four (§4.3).
 */
export function solveKey(
  modelHash: string,
  request: SolveRequest,
): { key: string; canonical: string } {
  const canonical = `${modelHash}\u0000${stableStringify(request)}`;
  return { key: hashString(canonical), canonical };
}
