import type { Model } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import { scopeStats } from './analytics';
import { setFactoryParent } from './editing';
import { resolveWorld } from './resolve';
import { buildWorld } from './testing';
import type { SolveFactory } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();
const solveFactory: SolveFactory = (r) => solve(model, r, backend);

/** Parent "p" makes Reinforced Iron Plate from its sub-factory "c"; "o" stands apart. */
const world = setFactoryParent(
  buildWorld([
    { id: 'p', targets: [{ item: 'reinforced-iron-plate', rate: 5 }] },
    { id: 'c', targets: [{ item: 'iron-plate', rate: 10 }] },
    { id: 'o', targets: [{ item: 'iron-rod', rate: 15 }] },
  ]),
  'c',
  'p',
);

describe('scopeStats (A81)', () => {
  test('matches the subtree, single-factory and world totals', async () => {
    const r = await resolveWorld(world, model, solveFactory);
    const p = r.factories.find((f) => f.id === 'p')!;
    const sub = scopeStats(r, p.subtree!.factories);
    expect(sub.factories).toEqual(['c', 'p']);
    expect(sub.ledger).toEqual(p.subtree!.ledger);
    expect(sub.power).toEqual(p.subtree!.power);
    expect(sub.nodes).toEqual(p.subtree!.nodes);
    expect(sub.machines).toBe(p.subtree!.machines);

    const all = scopeStats(r, ['p', 'o', 'c', 'gone']);
    expect(all.factories).toEqual(['c', 'o', 'p']);
    expect(all.ledger).toEqual(r.ledger);
    expect(all.machines).toBe(r.machines);
    expect(all.power.netMW).toBeCloseTo(r.power.netMW, 9);

    for (const f of r.factories) {
      const one = scopeStats(r, [f.id]);
      expect(one.ledger).toEqual(f.ledger);
      expect(one.extraction).toEqual(f.extraction);
      expect(one.running).toBeCloseTo(
        f.plan.reduce((s, e) => s + e.machines, 0),
        9,
      );
    }
  });

  test('a link inside the scope nets out; one crossing it is an import or export', async () => {
    const r = await resolveWorld(world, model, solveFactory);
    const inner = r.links.filter((l) => l.from === 'c' && l.to === 'p');
    expect(inner.length).toBeGreaterThan(0);
    const both = scopeStats(r, ['c', 'p']);
    const child = scopeStats(r, ['c']);
    for (const l of inner) {
      expect(child.ledger.find((x) => x.item === l.item)!.exported).toBeCloseTo(l.delivered, 9);
      expect(both.ledger.find((x) => x.item === l.item)?.exported ?? 0).toBe(0);
    }
    const ore = (s: typeof both) => s.extraction.reduce((t, e) => t + e.rate, 0);
    expect(ore(both)).toBeCloseTo(ore(child) + ore(scopeStats(r, ['p'])), 9);
  });
});
