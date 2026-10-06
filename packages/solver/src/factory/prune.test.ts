import type { Model, Recipe } from '@sps/data';
import { describe, expect, test } from 'vitest';
import { createHighsBackend } from '../lp/highs';
import { MIN_BRANCH, solve } from './solve';
import type { SolveRequest, SolveResult } from './types';

/**
 * The prune pass (A34). Two routes make plates from ore: `slow` is lean on ore
 * (1 per plate) but takes a machine per plate/min; `fast` burns 2 ore per
 * plate at 100 plates/min. Resources first, machines second: stage 2 spends
 * stage 1's 0.01% room on a sliver of `fast` (about 1e-5 machines).
 */
const backend = createHighsBackend();

const base = (id: string, extra: Partial<Recipe>): Recipe => ({
  id,
  name: id,
  machine: id,
  kind: 'production',
  alternate: false,
  tier: '0-0',
  inputs: [],
  outputs: [],
  powerMW: 0,
  clock: 1,
  source: 'dataset',
  ...extra,
});

const model: Model = {
  meta: { schemaVersion: 2, dataHash: 'prune', minerMk: 1 },
  items: ['ore', 'plate'].map((id) => ({
    id,
    name: id,
    form: 'solid' as const,
    sinkPoints: 0,
    tier: '0-0',
  })),
  machines: [],
  recipes: [
    base('mine-ore', {
      kind: 'extraction',
      outputs: [{ item: 'ore', rate: 60 }],
      powerMW: 5,
      node: 'node:ore:normal',
    }),
    base('slow', {
      inputs: [{ item: 'ore', rate: 1 }],
      outputs: [{ item: 'plate', rate: 1 }],
    }),
    base('fast', {
      inputs: [{ item: 'ore', rate: 200 }],
      outputs: [{ item: 'plate', rate: 100 }],
    }),
  ],
  nodes: [{ id: 'node:ore:normal', resource: 'ore', purity: 'normal', count: 100, nne: 1 }],
  beltCapacities: [],
};

const plates: SolveRequest = {
  targets: [{ item: 'plate', rate: 10 }],
  objectives: ['resources', 'machines'],
};

const machines = (r: SolveResult, id: string) => r.recipes.find((x) => x.id === id)?.machines;

describe('prune pass (A34)', () => {
  test('without it, the second stage leaves a sliver of the other route', async () => {
    const r = await solve(model, { ...plates, minBranch: 0 }, backend);
    expect(r.status).toBe('ok');
    expect(machines(r, 'fast')).toBeGreaterThan(0);
    expect(machines(r, 'fast')).toBeLessThan(MIN_BRANCH);
    expect(r.stats.pruned).toBeUndefined();
  });

  test('by default, the sliver is dropped and every stage stays within tolerance', async () => {
    const r = await solve(model, plates, backend);
    expect(r.status).toBe('ok');
    expect(r.recipes.map((x) => x.id)).toEqual(['mine-ore', 'slow']);
    expect(machines(r, 'slow')).toBeCloseTo(10, 9);
    expect(r.stats.pruned).toEqual(['fast']);
    for (const s of r.stages) expect(s.value).toBeLessThanOrEqual(s.optimum * (1 + 1e-4) + 1e-9);
  });

  test('a small branch the plan needs is kept', async () => {
    // 0.005 plates/min takes 0.005 machines of `slow` (or less of `fast`):
    // one of them has to run, however small.
    const r = await solve(
      model,
      { ...plates, targets: [{ item: 'plate', rate: 0.005 }], recipes: { exclude: ['fast'] } },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(machines(r, 'slow')).toBeCloseTo(0.005, 9);
    expect(r.stats.pruned).toBeUndefined();
  });

  test('with a larger threshold, a needed branch below it stays', async () => {
    // The miner runs 1/6 machine, under 0.5, but the plan can't do without it.
    const r = await solve(model, { ...plates, minBranch: 0.5 }, backend);
    expect(r.status).toBe('ok');
    expect(machines(r, 'mine-ore')).toBeCloseTo(1 / 6, 9);
    expect(machines(r, 'fast')).toBeUndefined();
    expect(r.stats.pruned).toEqual(['fast']);
  });

  test('is deterministic', async () => {
    const a = await solve(model, plates, backend);
    const b = await solve(model, plates, backend);
    expect(b).toEqual(a);
  });

  test('a negative or non-finite threshold is rejected', async () => {
    for (const minBranch of [-0.01, Number.NaN, Infinity]) {
      const r = await solve(model, { ...plates, minBranch }, backend);
      expect(r.status).toBe('error');
      expect(r.diagnostics[0]!.code).toBe('invalid-request');
    }
  });
});
