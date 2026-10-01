import { describe, expect, test } from 'vitest';
import { hashString, solveKey, stableStringify } from './hash';

describe('cache keys', () => {
  test('stableStringify sorts keys, drops undefined and keeps Infinity', () => {
    expect(stableStringify({ b: 1, a: [{ d: Infinity, c: undefined }] })).toBe(
      '{"a":[{"d":"Infinity"}],"b":1}',
    );
    expect(stableStringify({ x: 1, y: 2 })).toBe(stableStringify({ y: 2, x: 1 }));
  });

  test('hashString is FNV-1a 64', () => {
    expect(hashString('')).toBe('cbf29ce484222325');
    expect(hashString('a')).toBe('af63dc4c8601ec8c');
  });

  test('the key covers the model hash and every request field', () => {
    const r = { targets: [{ item: 'iron-plate', rate: 60 }] };
    const k = solveKey('m1', r).key;
    expect(solveKey('m1', { targets: [{ rate: 60, item: 'iron-plate' }] }).key).toBe(k);
    expect(solveKey('m2', r).key).not.toBe(k);
    expect(solveKey('m1', { ...r, demand: [{ item: 'iron-plate', rate: 1 }] }).key).not.toBe(k);
    expect(solveKey('m1', { ...r, nodeBudget: {} }).key).not.toBe(k);
  });
});
