import type { Model } from '@sps/data';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../../fixtures/vanilla-mini/model.json';
import { createHighsBackend } from '../lp/highs';
import { DUMPABLE_FLUIDS, solve } from './solve';
import type { SolveRequest } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();
// Plastic leaves Heavy Oil Residue over, and nothing in vanilla-mini uses it.
const plastic20: SolveRequest = { targets: [{ item: 'plastic', rate: 20 }] };

describe('solve: avoid fluid byproducts (A39)', () => {
  test('off by default: the residue is surplus', async () => {
    const r = await solve(model, plastic20, backend);
    expect(r.status).toBe('ok');
    expect(r.surplus).toEqual([{ item: 'heavy-oil-residue', rate: expect.closeTo(10, 9) }]);
  });

  test('on: a fluid that would be left over makes the plan infeasible, with the amount', async () => {
    const r = await solve(model, { ...plastic20, avoidFluidByproducts: true }, backend);
    expect(r.status).toBe('infeasible');
    const d = r.diagnostics[0];
    expect(d?.code).toBe('infeasible');
    if (d?.code !== 'infeasible') return;
    expect(d.relaxations).toEqual([
      { kind: 'surplus', item: 'heavy-oil-residue', amount: expect.closeTo(10, 6) },
    ]);
    expect(d.message).toMatch(/Heavy Oil Residue left over/);
  });

  test('on: a fluid the plan delivers is not a byproduct', async () => {
    const r = await solve(
      model,
      {
        ...plastic20,
        demand: [{ item: 'heavy-oil-residue', rate: 10 }],
        avoidFluidByproducts: true,
      },
      backend,
    );
    expect(r.status).toBe('ok');
    expect(r.surplus).toEqual([]);
  });

  test('on: solid byproducts and plans without fluid leftovers are unchanged', async () => {
    const req: SolveRequest = { targets: [{ item: 'iron-plate', rate: 60 }] };
    const off = await solve(model, req, backend);
    const on = await solve(model, { ...req, avoidFluidByproducts: true }, backend);
    expect(on).toEqual(off);
  });

  test('Steam and Flue Gas are the dumpable fluids', () => {
    expect([...DUMPABLE_FLUIDS].sort()).toEqual(['flue-gas', 'steam']);
  });
});
