import type { Model } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import type { World } from './document';
import { WorldEditError } from './editing';
import {
  discardManual,
  enterManual,
  leaveManual,
  manualEntries,
  manualOutcome,
  revertManual,
  setManualCount,
  undoManual,
} from './manual';
import { resolveWorld } from './resolve';
import { buildWorld, fixed, pull } from './testing';
import type { SolveFactory } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();
const solveFactory: SolveFactory = (r) => solve(model, r, backend);

/** Factory "a" making 60 Iron Plate/min. */
const plates = (): World => buildWorld([{ id: 'a', targets: [{ item: 'iron-plate', rate: 60 }] }]);
const manualOf = (w: World, id = 'a') => w.factories.find((f) => f.id === id)!.manual;
const rate = (rows: readonly { item: string; rate: number }[], item: string) =>
  rows.find((r) => r.item === item)?.rate ?? 0;

describe('manual plans (A36)', () => {
  test('edits apply over the frozen plan; 0 removes a group', () => {
    expect(
      manualEntries({
        frozen: [
          { recipe: 'iron-ingot', machines: 2 },
          { recipe: 'mine-iron-ore', machines: 1 },
        ],
        edits: [
          { recipe: 'iron-ingot', machines: 3 },
          { recipe: 'iron-plate', machines: 1.5 },
          { recipe: 'mine-iron-ore', machines: 0 },
        ],
      }),
    ).toEqual([
      { recipe: 'iron-ingot', machines: 3 },
      { recipe: 'iron-plate', machines: 1.5 },
    ]);
  });

  test('enter freezes, leave keeps the plan, enter restores it, discard drops it', () => {
    const frozen = [{ recipe: 'iron-plate', machines: 3 }];
    let w = enterManual(plates(), 'a', frozen);
    expect(manualOf(w)).toEqual({ enabled: true, frozen, edits: [] });
    w = setManualCount(w, 'a', 'iron-plate', 4);
    w = leaveManual(w, 'a');
    expect(manualOf(w)).toMatchObject({ enabled: false, edits: [{ machines: 4 }] });
    // Entering again restores the stored plan; the new plan is ignored.
    w = enterManual(w, 'a', [{ recipe: 'screw', machines: 9 }]);
    expect(manualEntries(manualOf(w)!)).toEqual([{ recipe: 'iron-plate', machines: 4 }]);
    w = discardManual(w, 'a');
    expect(manualOf(w)).toBeUndefined();
    expect(w.factories[0]).toEqual(plates().factories[0]);
  });

  test('undo walks back 120 edits one at a time; revert all returns to the frozen plan', () => {
    const frozen = [{ recipe: 'iron-plate', machines: 3 }];
    let w = enterManual(plates(), 'a', frozen);
    const steps: World[] = [w];
    for (let k = 1; k <= 120; k++) {
      w = setManualCount(w, 'a', 'iron-plate', 3 + k / 10);
      steps.push(w);
    }
    expect(manualOf(w)!.edits).toHaveLength(120);
    expect(manualOf(revertManual(w, 'a'))).toEqual({ enabled: true, frozen, edits: [] });
    for (let k = 120; k > 0; k--) {
      w = undoManual(w, 'a');
      expect(manualOf(w)).toEqual(manualOf(steps[k - 1]!));
    }
    expect(undoManual(w, 'a')).toBe(w);
  });

  test('setting the count a group has changes nothing; bad edits throw', () => {
    const w = enterManual(plates(), 'a', [{ recipe: 'iron-plate', machines: 3 }]);
    expect(setManualCount(w, 'a', 'iron-plate', 3)).toBe(w);
    expect(setManualCount(w, 'a', 'screw', 0)).toBe(w);
    expect(() => setManualCount(w, 'a', 'iron-plate', -1)).toThrow(WorldEditError);
    expect(() => setManualCount(plates(), 'a', 'iron-plate', 1)).toThrow(/not in manual mode/);
    expect(() => enterManual(w, 'nope', [])).toThrow(WorldEditError);
  });

  test('freezing a solved plan reproduces its flows, power and nodes', async () => {
    for (const target of [
      { item: 'iron-plate', rate: 60 },
      { item: 'reinforced-iron-plate', rate: 5 },
      { item: 'mw', rate: 150 },
    ]) {
      const w = buildWorld([{ id: 'a', targets: [target] }]);
      const solved = (await resolveWorld(w, model, solveFactory)).factories[0]!;
      const plan = solved.result.recipes.map((r) => ({ recipe: r.id, machines: r.machines }));
      const frozen = (await resolveWorld(enterManual(w, 'a', plan), model, solveFactory))
        .factories[0]!;
      expect(frozen.key).toBe('manual');
      expect(frozen.manual).toEqual({ missing: [], targets: [target] });
      const close = (a: number, b: number) =>
        expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(b)));
      for (const row of solved.ledger) {
        const m = frozen.ledger.find((r) => r.item === row.item)!;
        for (const k of ['produced', 'consumed', 'target', 'surplus', 'unmet'] as const)
          close(m[k], row[k]);
      }
      close(frozen.power.consumptionMW, solved.power.consumptionMW);
      close(frozen.power.generationMW, solved.power.generationMW);
      expect(frozen.nodes.map((n) => n.node)).toEqual(solved.nodes.map((n) => n.node));
      expect(frozen.machines).toBe(solved.machines);
    }
  });

  test('a shortfall beyond the import caps is missing, and reported', async () => {
    // 3 constructors want 90 ingots; 2 smelters make 60; 10 more may be imported.
    let w = buildWorld([
      {
        id: 'a',
        targets: [{ item: 'iron-plate', rate: 60 }],
        unassignedImports: [{ item: 'iron-ingot', cap: 10 }],
      },
    ]);
    w = enterManual(w, 'a', [
      { recipe: 'iron-plate', machines: 3 },
      { recipe: 'iron-ingot', machines: 2 },
      { recipe: 'mine-iron-ore', machines: 1 },
    ]);
    const r = await resolveWorld(w, model, solveFactory);
    const f = r.factories[0]!;
    expect(f.manual!.missing).toEqual([{ item: 'iron-ingot', rate: 20 }]);
    expect(rate(f.result.imports, 'iron-ingot')).toBe(30);
    // The ledger counts all 30 as unmet: nothing in the save supplies them.
    expect(f.ledger.find((l) => l.item === 'iron-ingot')).toMatchObject({ unmet: 30 });
    const d = r.diagnostics.find((x) => x.code === 'manual-short');
    expect(d).toMatchObject({ factory: 'a', missing: [{ item: 'iron-ingot', rate: 20 }] });
    // A short target is reported too: drop a constructor.
    const less = setManualCount(w, 'a', 'iron-plate', 2);
    const r2 = await resolveWorld(less, model, solveFactory);
    expect(r2.factories[0]!.manual!.targets).toEqual([{ item: 'iron-plate', rate: 40 }]);
    expect(r2.diagnostics.find((x) => x.code === 'manual-short')).toMatchObject({
      targets: [{ item: 'iron-plate', rate: 20 }],
    });
  });

  test('a manual producer ships what is left after its targets; its links run short', async () => {
    // A makes 60 plates (3 constructors), keeps 30 for its target, and owes B 40;
    // B's 7 reinforced plates/min draw all 40 (free imports), so B comes up short.
    let w = buildWorld(
      [
        { id: 'a', targets: [{ item: 'iron-plate', rate: 30 }] },
        { id: 'b', targets: [{ item: 'reinforced-iron-plate', rate: 7 }] },
      ],
      [fixed('l1', 'a', 'b', 'iron-plate', 40)],
    );
    w = enterManual(w, 'a', [
      { recipe: 'iron-plate', machines: 3 },
      { recipe: 'iron-ingot', machines: 3 },
      { recipe: 'mine-iron-ore', machines: 1.5 },
    ]);
    const r = await resolveWorld(w, model, solveFactory);
    const link = r.links.find((l) => l.id === 'l1')!;
    expect(link).toMatchObject({ requested: 40, delivered: 30, short: 10 });
    expect(r.factories.find((f) => f.id === 'b')!.status).toBe('short');
    expect(r.diagnostics.find((d) => d.code === 'link-short')!.message).toMatch(/manual mode/);
  });

  test('a pull link into a manual factory carries all it needs, so nothing is missing', async () => {
    let w = buildWorld(
      [{ id: 'ore' }, { id: 'a', targets: [{ item: 'iron-ingot', rate: 30 }] }],
      [pull('l1', 'ore', 'a', 'iron-ore')],
    );
    w = enterManual(w, 'a', [{ recipe: 'iron-ingot', machines: 2 }]);
    const r = await resolveWorld(w, model, solveFactory);
    expect(r.factories.find((f) => f.id === 'a')!.manual!.missing).toEqual([]);
    expect(r.links[0]).toMatchObject({ requested: 60, delivered: 60 });
    expect(
      rate(
        r.factories
          .find((f) => f.id === 'ore')!
          .result.recipes.map((x) => ({ item: x.id, rate: x.machines })),
        'mine-iron-ore',
      ),
    ).toBeCloseTo(1, 9);
  });

  test('the arithmetic skips unknown recipes and counts generation as negative draw', () => {
    const o = manualOutcome(
      model,
      [
        { recipe: 'coal-generator', machines: 2 },
        { recipe: 'gone', machines: 5 },
      ],
      { targets: [{ item: 'mw', rate: 100 }] },
    );
    expect(o.result.recipes.map((r) => r.id)).toEqual(['coal-generator']);
    expect(o.result.power).toEqual({ consumptionMW: 0, generationMW: 150, netMW: -150 });
    expect(o.targets).toEqual([{ item: 'mw', rate: 100 }]);
    expect(o.result.surplus).toEqual([{ item: 'mw', rate: 50 }]);
    expect(o.missing).toEqual([
      { item: 'coal', rate: 30 },
      { item: 'water', rate: 90 },
    ]);
  });

  test('miner fluid supplied from outside is not missing; other uses of it are (A69)', () => {
    const recipe = (id: string, inputs: { item: string; rate: number }[], fluid?: string) =>
      ({
        id,
        name: id,
        machine: 'm',
        inputs,
        outputs: [{ item: 'ore', rate: 60 }],
        powerMW: 0,
        ...(fluid ? { route: { resource: 'ore', purity: 'normal', processing: 'x', fluid } } : {}),
      }) as unknown as Model['recipes'][number];
    const mini = {
      nodes: [],
      recipes: [
        recipe('miner', [{ item: 'water', rate: 30 }], 'water'),
        recipe('wash', [{ item: 'water', rate: 10 }]),
      ],
    };
    const entries = [
      { recipe: 'miner', machines: 1 },
      { recipe: 'wash', machines: 1 },
    ];
    const outside = manualOutcome(mini, entries, {
      targets: [],
      minerFluidSupply: 'outside',
    });
    expect(outside.missing).toEqual([{ item: 'water', rate: 10 }]);
    expect(outside.result.minerSupply).toEqual([{ item: 'water', rate: 30 }]);
    expect(manualOutcome(mini, entries, { targets: [] }).missing).toEqual([
      { item: 'water', rate: 40 },
    ]);
  });
});
