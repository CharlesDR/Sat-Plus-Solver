import type { Model, Recipe } from '@sps/data';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../../fixtures/vanilla-mini/model.json';
import { createHighsBackend } from '../lp/highs';
import { extractionOf, rawResources } from './resources';
import { solve } from './solve';
import type { SolveRequest } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();
const plate60: SolveRequest = { targets: [{ item: 'iron-plate', rate: 60 }] };

describe('raw resources (A33)', () => {
  test('lists node resources with their map maximum and unlimited ones without', () => {
    expect(rawResources(model)).toEqual([
      { item: 'coal', limited: true, mapMax: 600 },
      { item: 'copper-ore', limited: true, mapMax: 600 },
      { item: 'crude-oil', limited: true, mapMax: 600 },
      { item: 'iron-ore', limited: true, mapMax: 2400 },
      { item: 'limestone', limited: true, mapMax: 1200 },
      { item: 'water', limited: false },
    ]);
  });

  test('the map maximum follows node pool edits', () => {
    const iron = rawResources(model, { 'node:iron-ore:normal': 2 }).find(
      (r) => r.item === 'iron-ore',
    );
    expect(iron?.mapMax).toBe(120);
  });

  test("a recipe's `extracts` wins over its output", () => {
    const miner: Recipe = {
      ...model.recipes.find((r) => r.id === 'mine-iron-ore')!,
      outputs: [{ item: 'iron-ingot', rate: 60 }],
      extracts: { item: 'iron-ore', rate: 45 },
    };
    expect(extractionOf(miner, () => 'iron-ore')).toEqual({ item: 'iron-ore', rate: 45 });
    expect(
      extractionOf(
        model.recipes.find((r) => r.id === 'iron-plate')!,
        () => undefined,
      ),
    ).toBe(undefined);
  });
});

describe('solve: resource limits (A33)', () => {
  test('a limit above what the plan needs is reported with the extraction', async () => {
    const r = await solve(model, { ...plate60, resourceLimits: { 'iron-ore': 120 } }, backend);
    expect(r.status).toBe('ok');
    expect(r.extraction).toEqual([{ item: 'iron-ore', rate: expect.closeTo(90, 9), limit: 120 }]);
  });

  test('a resource without a limit is reported without one', async () => {
    const r = await solve(model, plate60, backend);
    expect(r.extraction).toEqual([{ item: 'iron-ore', rate: expect.closeTo(90, 9) }]);
  });

  test('a limit below what the plan needs reports the missing rate', async () => {
    const r = await solve(model, { ...plate60, resourceLimits: { 'iron-ore': 60 } }, backend);
    expect(r.status).toBe('infeasible');
    expect(r.diagnostics).toEqual([
      {
        code: 'infeasible',
        severity: 'error',
        message: 'Infeasible: needs 30/min more Iron Ore than its limit.',
        relaxations: [{ kind: 'resource', item: 'iron-ore', amount: expect.closeTo(30, 9) }],
      },
    ]);
  });

  test('a resource turned off reports what the plan would need of it', async () => {
    const r = await solve(model, { ...plate60, resourceLimits: { 'iron-ore': 0 } }, backend);
    expect(r.status).toBe('infeasible');
    expect(r.diagnostics[0]?.message).toBe(
      'Infeasible: needs 90/min of Iron Ore, which is turned off.',
    );
  });

  test('turning a resource off moves the plan to another one', async () => {
    const cable: SolveRequest = {
      targets: [{ item: 'cable', rate: 30 }],
      objective: 'scarcity',
      recipes: { alternates: true },
    };
    const free = await solve(model, cable, backend);
    expect(free.extraction.map((e) => e.item)).toEqual(['iron-ore']);
    const noIron = await solve(model, { ...cable, resourceLimits: { 'iron-ore': 0 } }, backend);
    expect(noIron.status).toBe('ok');
    expect(noIron.extraction.map((e) => e.item)).toEqual(['copper-ore']);
  });

  test('a negative or unknown limit is rejected', async () => {
    const neg = await solve(model, { ...plate60, resourceLimits: { 'iron-ore': -1 } }, backend);
    expect(neg.diagnostics[0]?.code).toBe('invalid-request');
    const unknown = await solve(model, { ...plate60, resourceLimits: { unobtainium: 1 } }, backend);
    expect(unknown.diagnostics[0]?.code).toBe('invalid-request');
  });
});
