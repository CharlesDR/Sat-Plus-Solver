import type { Model } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import {
  checkBuild,
  clearBuilt,
  markAllBuilt,
  markBuilt,
  restoreBuild,
  type BuildSource,
} from './built';
import type { Factory, World } from './document';
import { addTweak, WorldEditError } from './editing';
import { enterManual } from './manual';
import { resolveWorld } from './resolve';
import { buildWorld, fixed } from './testing';
import type { BuildFlag, SolveFactory, WorldResult } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();
const solveFactory: SolveFactory = (r) => solve(model, r, backend);
const AT = '2026-10-07T12:00:00.000Z';

const resolve = (w: World) => resolveWorld(w, model, solveFactory);
const of = (r: WorldResult, id = 'a') => r.factories.find((f) => f.id === id)!;
const factory = (w: World, id = 'a') => w.factories.find((f) => f.id === id)!;
const flag = <K extends BuildFlag['kind']>(r: WorldResult, kind: K, id = 'a') =>
  of(r, id).build?.flags.find((f): f is Extract<BuildFlag, { kind: K }> => f.kind === kind);
const kinds = (r: WorldResult, id = 'a') => of(r, id).build?.flags.map((f) => f.kind);

/** Resolves `w`, marks factory `id` as built, and returns the marked world. */
async function marked(w: World, id = 'a'): Promise<World> {
  return markBuilt(w, of(await resolve(w), id), model.meta.dataHash, AT);
}

const setTargets = (w: World, id: string, targets: Factory['request']['targets']): World => ({
  ...w,
  factories: w.factories.map((f) =>
    f.id === id ? { ...f, request: { ...f.request, targets } } : f,
  ),
});

/** Factory "a" making 60 Iron Plate/min from ore. */
const plates = () => buildWorld([{ id: 'a', targets: [{ item: 'iron-plate', rate: 60 }] }]);

describe('build marks (A44)', () => {
  test('a marked solved factory matches its build, and the mark survives as data', async () => {
    const w = await marked(plates());
    const built = factory(w).built!;
    expect(built.entries).toEqual([
      { recipe: 'iron-ingot', machines: 3 },
      { recipe: 'iron-plate', machines: 3 },
      { recipe: 'mine-iron-ore', machines: 1.5 },
    ]);
    expect(built.outputs).toEqual([{ item: 'iron-plate', rate: 60 }]);
    expect(built.markedAt).toBe(AT);
    const r = await resolve(w);
    expect(of(r).build).toEqual({ state: 'matches', flags: [], causes: [], markedAt: AT });
    expect(r.diagnostics.some((d) => d.code === 'build-drift')).toBe(false);
  });

  test('a marked manual factory matches its build', async () => {
    let w = plates();
    w = enterManual(w, 'a', of(await resolve(w)).plan);
    w = await marked(w);
    expect(of(await resolve(w)).build?.state).toBe('matches');
  });

  test('raising a target past the build needs expansion by the exact shortfall', async () => {
    const w = setTargets(await marked(plates()), 'a', [{ item: 'iron-plate', rate: 80 }]);
    const r = await resolve(w);
    expect(of(r).build?.state).toBe('broken');
    expect(flag(r, 'needs-expansion')?.items).toEqual([{ item: 'iron-plate', rate: 20 }]);
    // Today's plan grows too: 4 constructors, not 3.
    expect(flag(r, 'plan-changed')?.changes).toContainEqual({
      recipe: 'iron-plate',
      built: 3,
      now: 4,
    });
    expect(of(r).build?.causes).toEqual(['factory-settings']);
    expect(r.diagnostics.find((d) => d.code === 'build-drift')).toMatchObject({
      factory: 'a',
      state: 'broken',
    });
  });

  test('lowering a fixed import link leaves the build short of inputs', async () => {
    // "a" smelts 30 ingots for "b", which presses 20 plates from them.
    const world = (rate: number) =>
      buildWorld(
        [{ id: 'a' }, { id: 'b', targets: [{ item: 'iron-plate', rate: 20 }] }],
        [fixed('link-1', 'a', 'b', 'iron-ingot', rate)],
      );
    let w = await marked(world(30), 'b');
    expect(of(await resolve(w), 'b').build?.state).toBe('matches');
    w = { ...w, links: world(15).links };
    const r = await resolve(w);
    expect(flag(r, 'inputs-short', 'b')?.items).toEqual([{ item: 'iron-ingot', rate: 15 }]);
    expect(of(r, 'b').build?.causes).toContain('links');
  });

  test('a pull producer adapts, so the consumer is not blamed for it', async () => {
    const w = buildWorld(
      [{ id: 'a' }, { id: 'b', targets: [{ item: 'iron-plate', rate: 20 }] }],
      [{ id: 'link-1', from: 'a', to: 'b', item: 'iron-ingot', mode: { kind: 'pull' } }],
    );
    const r = await resolve(await marked(w, 'b'));
    expect(of(r, 'b').build?.state).toBe('matches');
  });

  test('swapping a built recipe is a changed plan with built and new counts', async () => {
    let w = buildWorld([
      {
        id: 'a',
        targets: [{ item: 'reinforced-iron-plate', rate: 5 }],
      },
    ]);
    w = await marked(w);
    w = addTweak(w, 'a', { kind: 'swap', from: 'screw', to: 'cast-screw' });
    const r = await resolve(w);
    expect(of(r).build?.state).toBe('differs');
    const changes = flag(r, 'plan-changed')!.changes;
    expect(changes).toContainEqual({ recipe: 'screw', built: 1.5, now: 0 });
    expect(changes).toContainEqual({ recipe: 'cast-screw', built: 0, now: 1.2 });
    // The built plan can still run: no error flags.
    expect(of(r).build!.flags.every((f) => f.severity !== 'error')).toBe(true);
  });

  test('halving the target only says the build can be reduced', async () => {
    const w = setTargets(await marked(plates()), 'a', [{ item: 'iron-plate', rate: 30 }]);
    const r = await resolve(w);
    expect(kinds(r)).toEqual(['can-reduce']);
    expect(of(r).build?.state).toBe('note');
    expect(flag(r, 'can-reduce')?.changes).toContainEqual({
      recipe: 'iron-plate',
      built: 3,
      now: 1.5,
    });
  });

  test('whole-machine factories compare whole buildings', async () => {
    const whole = (rate: number) =>
      buildWorld([
        { id: 'a', targets: [{ item: 'iron-plate', rate }], request: { wholeMachines: true } },
      ]);
    const w = await marked(whole(50));
    // 50 → 55 plates/min still needs 3 constructors, 3 smelters, 2 miners: no change.
    const same = await resolve(setTargets(w, 'a', [{ item: 'iron-plate', rate: 55 }]));
    expect(kinds(same)).not.toContain('plan-changed');
    expect(kinds(same)).not.toContain('can-reduce');
    // And fractional factories see the same change.
    const frac = await marked(plates());
    const moved = await resolve(setTargets(frac, 'a', [{ item: 'iron-plate', rate: 55 }]));
    expect(kinds(moved)).toEqual(['can-reduce']);
  });

  test('lowering a resource limit puts the build over it', () => {
    // vanilla-mini has no extraction data, so give its iron miner some.
    const mined = {
      ...model,
      recipes: model.recipes.map((r) =>
        r.id === 'mine-iron-ore' ? { ...r, extracts: { item: 'iron-ore', rate: 60 } } : r,
      ),
    } as Model;
    const w = plates();
    const built = {
      entries: [{ recipe: 'mine-iron-ore', machines: 1.5 }],
      inputs: [],
      outputs: [],
      dataHash: model.meta.dataHash,
      markedAt: AT,
      fingerprint: { factory: '', world: '', links: '' },
    };
    const check = checkBuild(mined, w, factory(w), built, {
      request: {
        targets: [],
        objectives: ['scarcity'],
        tolerance: 0.0001,
        recipes: { alternates: false, exclude: [] },
        nodeBudget: 'pool',
        resourceLimits: { 'iron-ore': 60 },
      },
      plan: built.entries,
      planned: true,
      imports: [],
    });
    expect(check.flags).toContainEqual({
      kind: 'over-resource-limit',
      severity: 'error',
      items: [{ item: 'iron-ore', rate: 90, limit: 60 }],
    });
    expect(check.state).toBe('broken');
  });

  test('a recipe gone from the data and new game data are both flagged', async () => {
    const w = await marked(plates());
    const f = factory(w);
    const built = {
      ...f.built!,
      dataHash: 'older-data',
      entries: [...f.built!.entries, { recipe: 'retired-recipe', machines: 1 }],
    };
    const r = await resolve({ ...w, factories: [{ ...f, built }] });
    expect(flag(r, 'recipe-gone')?.recipes).toEqual(['retired-recipe']);
    expect(kinds(r)).toContain('data-changed');
    expect(of(r).build?.causes).toContain('game-data');
  });

  test('restore build reproduces the built flows in manual mode', async () => {
    const base = await marked(plates());
    const before = of(await resolve(base));
    let w = setTargets(base, 'a', [{ item: 'iron-plate', rate: 30 }]);
    w = restoreBuild(w, 'a');
    expect(factory(w).manual).toEqual({
      enabled: true,
      frozen: factory(base).built!.entries,
      edits: [],
    });
    const after = of(await resolve(setTargets(w, 'a', [{ item: 'iron-plate', rate: 60 }])));
    for (const row of before.ledger) {
      const m = after.ledger.find((x) => x.item === row.item)!;
      for (const k of ['produced', 'consumed', 'target', 'surplus'] as const)
        expect(Math.abs(m[k] - row[k])).toBeLessThanOrEqual(1e-6 * Math.max(1, row[k]));
    }
    expect(after.build?.state).toBe('matches');
  });

  test('mark all skips failed factories; clear removes a mark; bad edits throw', async () => {
    const w = buildWorld([
      { id: 'a', targets: [{ item: 'iron-plate', rate: 60 }] },
      {
        id: 'b',
        targets: [{ item: 'iron-plate', rate: 60 }],
        resources: { 'iron-ore': { enabled: false } },
      },
    ]);
    const r = await resolve(w);
    const sources: BuildSource[] = r.factories;
    const all = markAllBuilt(w, sources, model.meta.dataHash, AT);
    expect(of(r, 'b').status).toBe('infeasible');
    expect(all.skipped).toEqual(['b']);
    expect(factory(all.world).built).toBeDefined();
    const cleared = clearBuilt(all.world, 'a');
    expect(factory(cleared).built).toBeUndefined();
    expect(clearBuilt(cleared, 'a')).toBe(cleared);
    expect(() => restoreBuild(cleared, 'a')).toThrow(/not marked/);
    expect(() => markBuilt(w, { ...of(r), status: 'infeasible' }, '', AT)).toThrow(WorldEditError);
  });
});
