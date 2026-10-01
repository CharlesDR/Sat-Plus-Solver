import { describe, expect, test } from 'vitest';
import { addObjective, moveObjective } from './ObjectiveStack';
import { asPercent } from './ToleranceInput';

describe('objective stack edits', () => {
  test('adds at the bottom, output on top, no repeats', () => {
    expect(addObjective(['resources'], 'machines')).toEqual(['resources', 'machines']);
    expect(addObjective(['resources'], 'output')).toEqual(['output', 'resources']);
    expect(addObjective(['resources'], 'resources')).toEqual(['resources']);
  });

  test('moves within the stack; output stays first', () => {
    expect(moveObjective(['resources', 'machines', 'power'], 2, -1)).toEqual([
      'resources',
      'power',
      'machines',
    ]);
    expect(moveObjective(['resources', 'machines'], 0, -1)).toEqual(['resources', 'machines']);
    expect(moveObjective(['output', 'machines'], 1, -1)).toEqual(['output', 'machines']);
    expect(moveObjective(['output', 'machines'], 0, 1)).toEqual(['output', 'machines']);
  });
});

test('tolerance shows as a clean percentage', () => {
  expect(asPercent(0.0001)).toBe('0.01');
  expect(asPercent(0.9)).toBe('90');
  expect(asPercent(0.07)).toBe('7');
});
