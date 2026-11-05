import { expect, test } from 'vitest';
import { compareModVersions } from './versions';

test('mod versions sort by their numbers, not as text (A111)', () => {
  expect(['2026.10.1', '2026.4.651', '2026.3.489', '2026.4.65'].sort(compareModVersions)).toEqual([
    '2026.3.489',
    '2026.4.65',
    '2026.4.651',
    '2026.10.1',
  ]);
  expect(compareModVersions('2026.4.651', '2026.4.651')).toBe(0);
});
