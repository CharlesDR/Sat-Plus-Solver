import { describe, expect, test } from 'vitest';
import { OBJECTIVE_IDS } from '@sps/solver';
import { addObjective, moveObjective, OBJECTIVE_ORDER } from './ObjectiveStack';
import { asPercent } from './ToleranceInput';
import type { CatalogResource } from '../solver/protocol';
import { limitsLabel, mapMax, rawResourcesOf, setEnabled, setMax } from './resourceLimits';

describe('objective stack edits', () => {
  test('the list offers every objective once, scarcity first', () => {
    expect(OBJECTIVE_ORDER[0]).toBe('scarcity');
    expect([...OBJECTIVE_ORDER].sort()).toEqual([...OBJECTIVE_IDS].sort());
  });

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

describe('resource limits (A33)', () => {
  const iron: CatalogResource = {
    id: 'iron-ore',
    name: 'Iron Ore',
    fluid: false,
    limited: true,
    nodes: [
      { id: 'node:iron-ore:normal', count: 40, rate: 60 },
      { id: 'node:iron-ore:pure', count: 2, rate: 120 },
    ],
  };
  const water: CatalogResource = { id: 'water', name: 'Water', fluid: true, limited: false };

  test('on with no limit is left out; off keeps the limit for later', () => {
    const limited = setMax({}, 'iron-ore', 500);
    expect(limited).toEqual({ 'iron-ore': { enabled: true, max: 500 } });
    const off = setEnabled(limited, 'iron-ore', false);
    expect(off).toEqual({ 'iron-ore': { enabled: false, max: 500 } });
    expect(setEnabled(off, 'iron-ore', true)).toEqual(limited);
    expect(setMax(limited, 'iron-ore', undefined)).toEqual({});
    expect(setMax(off, 'iron-ore', undefined)).toEqual({ 'iron-ore': { enabled: false } });
    expect(setEnabled({}, 'water', false)).toEqual({ water: { enabled: false } });
    expect(setEnabled({ water: { enabled: false } }, 'water', true)).toEqual({});
  });

  test('the map maximum follows pool edits; unlimited resources have none', () => {
    expect(mapMax(iron, {})).toBe(2640);
    expect(mapMax(iron, { 'node:iron-ore:pure': 0 })).toBe(2400);
    expect(mapMax(water, {})).toBeUndefined();
    expect(rawResourcesOf([iron, water], {})).toEqual([
      { item: 'iron-ore', limited: true, mapMax: 2640 },
      { item: 'water', limited: false },
    ]);
  });

  test('the heading counts what is off and what is limited', () => {
    expect(limitsLabel({})).toBe('all on, no limits');
    expect(limitsLabel({ water: { enabled: false }, 'iron-ore': { enabled: true, max: 5 } })).toBe(
      '1 off, 1 limited',
    );
  });
});
