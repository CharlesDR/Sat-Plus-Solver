import type { Flow, Recipe } from '@sps/data';
import { describe, expect, test } from 'vitest';
import { planStarters, producible, reach } from './reachability';

const flows = (fs: Record<string, number>): Flow[] =>
  Object.entries(fs).map(([item, rate]) => ({ item, rate }));
const recipe = (id: string, inputs: Record<string, number>, outputs: Record<string, number>) =>
  ({
    id,
    name: id,
    machine: 'm',
    kind: 'production',
    alternate: false,
    tier: '0-0',
    inputs: flows(inputs),
    outputs: flows(outputs),
    powerMW: 1,
    clock: 1,
    source: 'dataset',
  }) satisfies Recipe;

// The Lime Slug loop, as in SF+: a Terrarium lays 6 eggs from 1.2 slugs and
// 6 meal, a Hatchery hatches 12 eggs (with water) into 12 slugs.
const terrarium = recipe('terrarium', { slug: 1.2, meal: 6 }, { egg: 6 });
const hatchery = recipe('hatchery', { egg: 12, water: 30 }, { slug: 12, white: 3 });

describe('reachability with breeding loops (A74)', () => {
  test('a loop that nets positive runs from a starter, the breeding stock', () => {
    const r = reach([terrarium, hatchery], ['meal', 'water']);
    expect(r.starters).toEqual(['slug']);
    expect([...r.have].sort()).toEqual(['egg', 'meal', 'slug', 'water', 'white']);
  });

  test('a loop missing one of its other inputs does not run', () => {
    expect(reach([terrarium, hatchery], ['meal'])).toEqual({
      have: new Set(['meal']),
      starters: [],
    });
  });

  test('a loop that returns less than it takes does not run', () => {
    const lossy = recipe('lossy', { egg: 12, water: 30 }, { slug: 0.2 });
    expect(producible([terrarium, lossy], ['meal', 'water']).has('slug')).toBe(false);
    const even = recipe('even', { egg: 6, water: 30 }, { slug: 1.2 });
    expect(producible([terrarium, even], ['meal', 'water']).has('slug')).toBe(false);
  });

  test('a loop fed by another loop runs once the first one does', () => {
    const slime = recipe('slime', { white: 30 }, { 'slug-slime': 60 });
    const pinkTerrarium = recipe('pink-terrarium', { pink: 1.2, meal: 6 }, { 'pink-egg': 6 });
    const pinkHatchery = recipe('pink-hatchery', { 'pink-egg': 6, 'slug-slime': 40 }, { pink: 6 });
    const r = reach([terrarium, hatchery, slime, pinkTerrarium, pinkHatchery], ['meal', 'water']);
    expect(r.starters).toEqual(['pink', 'slug']);
    expect(r.have.has('pink')).toBe(true);
  });

  test('without a loop nothing changes', () => {
    const line = recipe('line', { ore: 1 }, { ingot: 1 });
    expect(reach([line], ['ore'])).toEqual({ have: new Set(['ore', 'ingot']), starters: [] });
  });
});

describe('planStarters (A74)', () => {
  test('names the breeding stock when a loop step needs two loop items', () => {
    // The Hatchery needs slime composted from the loop's own slugs.
    const compost = recipe('compost', { slug: 1 }, { slime: 2 });
    const pink = recipe('pink', { egg: 6, slime: 4 }, { slug: 6 });
    expect(
      planStarters([terrarium, pink, compost], ['meal'], new Set(['slug', 'egg', 'slime'])),
    ).toEqual(['slug']);
  });

  test('names one more starter when the loop deadlocks on its own meal', () => {
    const farm = recipe('farm', { white: 3 }, { meal: 6 });
    expect(
      planStarters(
        [terrarium, hatchery, farm],
        ['water'],
        new Set(['slug', 'egg', 'white', 'meal']),
      ),
    ).toEqual(['slug', 'white']);
  });

  test('needs no starter when the loop item is imported or no loop runs', () => {
    const bred = new Set(['slug', 'egg']);
    expect(planStarters([terrarium, hatchery], ['meal', 'water', 'slug'], bred)).toEqual([]);
    expect(planStarters([terrarium], ['meal', 'slug'], bred)).toEqual([]);
  });

  test('a recycling loop of items the map also yields needs no starter', () => {
    expect(planStarters([terrarium, hatchery], ['meal', 'water'], new Set())).toEqual([]);
  });
});
