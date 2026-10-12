import { describe, expect, test } from 'vitest';
import { withRecent } from '../ui/prefs';
import { itemsUpToTier, tierOptions } from './tiers';

describe('max tier as major tiers (UX-5, UX-17)', () => {
  const tiers = ['0-3', '0-6', '1-1', '1-5', '2-0', '2-6', '10-0'];

  test('one option per major tier from 1, storing its highest dataset tier', () => {
    expect(tierOptions(tiers)).toEqual([
      { value: '1-5', label: 'T1' },
      { value: '2-6', label: 'T2' },
      { value: '10-0', label: 'T10' },
    ]);
  });

  test('a saved limit inside a major keeps an option of its own, in tier order', () => {
    expect(tierOptions(tiers, '2-0').map((o) => o.label)).toEqual([
      'T1',
      'T2 (up to 2-0)',
      'T2',
      'T10',
    ]);
    expect(tierOptions(tiers, '2-6')).toHaveLength(3);
    expect(tierOptions(tiers, null)).toHaveLength(3);
  });

  test('the Targets picker offers items made at or below max tier', () => {
    const items = [
      { id: 'a', name: 'A', tier: '0-0' },
      { id: 'b', name: 'B', tier: '2-1' },
      { id: 'c', name: 'C', tier: '1-5' },
      { id: 'd', name: 'D' },
    ];
    expect(itemsUpToTier(items, '1-5').map((i) => i.id)).toEqual(['a', 'c', 'd']);
    expect(itemsUpToTier(items, null)).toBe(items);
  });
});

test('recent targets put the newest first, without repeats, six at most', () => {
  expect(withRecent(['a', 'b', 'c'], ['b'])).toEqual(['b', 'a', 'c']);
  expect(withRecent(['a', 'b', 'c', 'd', 'e', 'f'], ['g'])).toEqual(['g', 'a', 'b', 'c', 'd', 'e']);
});
