import type { SummaryRecipe } from '@sps/solver';
import type { LedgerRow, LinkResult } from '@sps/world';
import { describe, expect, test } from 'vitest';
import { scopeView, type ScopeInput, type ScopeWorld } from './scope';

const row = (item: string, r: Partial<LedgerRow>): LedgerRow => ({
  item,
  produced: 0,
  consumed: 0,
  target: 0,
  imported: 0,
  exported: 0,
  surplus: 0,
  unmet: 0,
  ...r,
});
const power = (draw: number) => ({ consumptionMW: draw, generationMW: 0, netMW: draw });

/** Parent "p" draws 10 plate a minute from its sub-factory "c"; "o" stands apart. */
const link: LinkResult = {
  id: 'l1',
  from: 'c',
  to: 'p',
  item: 'plate',
  mode: 'pull',
  requested: 10,
  delivered: 10,
  used: 10,
  short: 0,
};
const world: ScopeWorld = {
  links: [link],
  factories: [
    {
      id: 'c',
      name: 'Child',
      ledger: [
        row('ore', { produced: 10, consumed: 10 }),
        row('plate', { produced: 10, exported: 10 }),
      ],
      power: power(4),
      nodes: [{ node: 'ore-normal', used: 1 }],
      machines: 2,
      plan: [{ recipe: 'plate', machines: 1.5 }],
      extraction: [{ item: 'ore', rate: 10 }],
    },
    {
      id: 'o',
      name: 'Other',
      ledger: [row('rod', { produced: 5, target: 5 })],
      power: power(1),
      nodes: [],
      machines: 1,
      plan: [{ recipe: 'rod', machines: 1 }],
      extraction: [],
    },
    {
      id: 'p',
      name: 'Parent',
      ledger: [
        row('plate', { consumed: 10, imported: 10 }),
        row('screw', { produced: 20, target: 20 }),
        row('coal', { consumed: 2, unmet: 2 }),
      ],
      power: power(3),
      nodes: [],
      machines: 3,
      plan: [{ recipe: 'screw', machines: 2.5 }],
      extraction: [],
      subtree: {
        factories: ['c', 'p'],
        internalLinks: ['l1'],
        boundaryLinks: [],
        ledger: [],
        power: power(7),
        nodes: [],
        machines: 5,
      },
    },
  ],
};
const recipe: SummaryRecipe = {
  id: 'screw',
  name: 'Screw',
  machine: 'Constructor',
  machines: 2.5,
  machinesCeil: 3,
  powerMW: 10,
  inputs: [{ item: 'plate', name: 'plate', rate: 10 }],
  outputs: [{ item: 'screw', name: 'screw', rate: 20 }],
};
const input = (over: Partial<ScopeInput>): ScopeInput => ({
  scope: 'current-below',
  factoryId: 'p',
  world,
  selection: undefined,
  recipes: [recipe],
  itemName: (id) => id.toUpperCase(),
  nodeLabel: (id) => `node ${id}`,
  ...over,
});
const totals = (over: Partial<ScopeInput>) => {
  const v = scopeView(input(over));
  if (v.kind !== 'scope') throw new Error(`expected a scope, got ${v.kind}`);
  return v.totals;
};
const rates = (rows: { item: string; rate: number }[]) =>
  Object.fromEntries(rows.map((r) => [r.item, r.rate]));

describe('scopeView (A81)', () => {
  test('Current & Below sums the subtree, netting out the link between them', () => {
    const t = totals({});
    expect(t.label).toBe('2 factories: Child, Parent');
    expect(rates(t.targets)).toEqual({ screw: 20 });
    expect(rates(t.extraction)).toEqual({ ore: 10 });
    // The plate link is inside the scope; the coal nobody supplies is still an import.
    expect(rates(t.imports)).toEqual({ coal: 2 });
    expect(t.exports).toEqual([]);
    expect(t.power.netMW).toBe(7);
    expect(t.machines).toBe(5);
    expect(t.running).toBe(4);
    expect(t.nodes).toEqual([{ node: 'ore-normal', label: 'node ore-normal', used: 1 }]);
    expect(t.targets[0]!.name).toBe('SCREW');
  });

  test('the open factory alone shows its own plan', () => {
    expect(scopeView(input({ scope: 'current' })).kind).toBe('plan');
    expect(scopeView(input({ factoryId: 'o' })).kind).toBe('plan');
    expect(scopeView(input({ world: undefined })).kind).toBe('plan');
  });

  test('Full World sums every factory', () => {
    const t = totals({ scope: 'world' });
    expect(t.label).toBe('3 factories: Child, Other, Parent');
    expect(rates(t.targets)).toEqual({ rod: 5, screw: 20 });
    expect(t.machines).toBe(6);
  });

  test('a selected sub-factory, alone or with what is below it', () => {
    const one = totals({ scope: 'selected', selection: 'sub:c' });
    expect(rates(one.exports)).toEqual({ plate: 10 });
    expect(totals({ scope: 'selected-below', selection: 'sub:p', factoryId: 'o' }).machines).toBe(
      5,
    );
    expect(scopeView(input({ scope: 'selected', selection: 'sub:p' })).kind).toBe('plan');
  });

  test('a selected recipe group: inputs come in, outputs go out', () => {
    const t = totals({ scope: 'selected', selection: 'recipe:screw' });
    expect(t.label).toBe('Recipe group: Screw');
    expect(rates(t.imports)).toEqual({ plate: 10 });
    expect(rates(t.exports)).toEqual({ screw: 20 });
    expect(t.power).toEqual({ consumptionMW: 10, generationMW: 0, netMW: 10 });
    expect([t.machines, t.running]).toEqual([3, 2.5]);
    const miner = {
      ...recipe,
      id: 'm',
      name: 'Miner',
      node: 'ore-normal',
      inputs: [],
      outputs: [{ item: 'ore', name: 'ore', rate: 60 }],
      machines: 1,
    };
    const m = totals({ scope: 'selected-below', selection: 'recipe:m', recipes: [miner] });
    expect(rates(m.extraction)).toEqual({ ore: 60 });
    expect(m.exports).toEqual([]);
    expect(m.nodes).toEqual([{ node: 'ore-normal', label: 'node ore-normal', used: 1 }]);
  });

  test('a Selected scope with nothing summable picked asks for a pick', () => {
    for (const selection of [undefined, 'target:screw', 'recipe:gone', 'sub:gone'])
      expect(scopeView(input({ scope: 'selected', selection })).kind).toBe('pick');
  });
});
