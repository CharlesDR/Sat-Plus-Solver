import type { Model } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import { markBuilt, restoreBuild } from './built';
import type { World } from './document';
import { addSite, scaleUp, setBuiltFactories } from './editing';
import { resolveWorld } from './resolve';
import { buildWorld, fixed, pull } from './testing';
import type { SolveFactory, WorldResult } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();
const solveFactory: SolveFactory = (r) => solve(model, r, backend);
const resolve = (w: World) => resolveWorld(w, model, solveFactory);
const link = (r: WorldResult, id: string) => r.links.find((l) => l.id === id)!;
const factory = (r: WorldResult, id: string) => r.factories.find((f) => f.id === id)!;

/** A plate factory feeding a RIP factory that wants `rip`/min (6 plates per RIP). */
function chain(rip: number): World {
  return buildWorld(
    [{ id: 'a' }, { id: 'b', targets: [{ item: 'reinforced-iron-plate', rate: rip }] }],
    [pull('ab', 'a', 'b', 'iron-plate')],
  );
}

/** `chain(3)` with A marked as built at 18 plates/min, then B raised to `rip`. */
async function heldAt18(rip: number): Promise<World> {
  const w = chain(3);
  const r = await resolve(w);
  const marked = markBuilt(w, factory(r, 'a'), model.meta.dataHash, '2026-10-15T00:00:00Z');
  return {
    ...marked,
    factories: marked.factories.map((f) =>
      f.id === 'b'
        ? { ...f, request: { targets: [{ item: 'reinforced-iron-plate', rate: rip }] } }
        : f,
    ),
  };
}

describe('split targets (A92)', () => {
  test('links draw on For links: the factory makes the larger of the two, plus Kept', async () => {
    const w = buildWorld(
      [{ id: 'a', targets: [{ item: 'iron-plate', rate: 20 }] }, { id: 'b' }],
      [fixed('ab', 'a', 'b', 'iron-plate', 18)],
    );
    const r = await resolve(w);
    expect(factory(r, 'a').request.targets).toEqual([{ item: 'iron-plate', rate: 2 }]);
    expect(factory(r, 'a').targets).toEqual([
      { item: 'iron-plate', forLinks: 20, kept: 0, taken: 18, spare: 2 },
    ]);
    const kept = buildWorld(
      [{ id: 'a', targets: [{ item: 'iron-plate', rate: 10, kept: 5 }] }, { id: 'b' }],
      [fixed('ab', 'a', 'b', 'iron-plate', 18)],
    );
    const k = factory(await resolve(kept), 'a');
    // max(10, 18) + 5.
    expect(k.result.items.find((i) => i.item === 'iron-plate')!.demand).toBeCloseTo(23, 9);
    expect(k.targets![0]).toMatchObject({ forLinks: 10, kept: 5, taken: 18, spare: 0 });
  });
});

describe('manual builds (A92)', () => {
  test('a manual factory whose build makes less than its For links needs expansion', async () => {
    const w = buildWorld([{ id: 'a', targets: [{ item: 'iron-plate', rate: 60 }] }], []);
    const marked = markBuilt(
      w,
      factory(await resolve(w), 'a'),
      model.meta.dataHash,
      '2026-10-15T00:00:00Z',
    );
    const manual = restoreBuild(marked, 'a');
    const raised: World = {
      ...manual,
      factories: manual.factories.map((f) => ({
        ...f,
        request: { ...f.request, targets: [{ item: 'iron-plate', rate: 80 }] },
      })),
    };
    const flags = factory(await resolve(raised), 'a').build!.flags;
    expect(flags.find((x) => x.kind === 'needs-expansion')).toMatchObject({
      items: [{ item: 'iron-plate', rate: 20 }],
    });
  });
});

describe('built factories hold (A92)', () => {
  test('a held factory caps its pull links at its build; the rest is a short link and a shortfall', async () => {
    const r = await resolve(await heldAt18(5));
    expect(factory(r, 'a').held).toBe(true);
    expect(link(r, 'ab')).toMatchObject({ requested: 30, delivered: 18, short: 12 });
    expect(factory(r, 'a').request.demand).toEqual([{ item: 'iron-plate', rate: 18 }]);
    expect(factory(r, 'b').status).toBe('short');
    expect(r.shortfalls).toEqual([
      {
        factory: 'a',
        item: 'iron-plate',
        missing: 12,
        holds: 18,
        links: ['ab'],
        consumers: ['b'],
        downstream: [],
        upstream: [],
      },
    ]);
    expect(r.diagnostics.find((d) => d.code === 'link-short')!.message).toMatch(
      /held at its build/,
    );
  });

  test('Grow, and Scale up, let it grow again', async () => {
    const w = await heldAt18(5);
    for (const grown of [setBuiltFactories(w, 'grow'), scaleUp(w, ['a'])]) {
      const r = await resolve(grown);
      expect(link(r, 'ab')).toMatchObject({ requested: 30, delivered: 30, short: 0 });
      expect(r.shortfalls).toEqual([]);
    }
    expect(setBuiltFactories(setBuiltFactories(w, 'grow'), 'hold').defaults).toEqual(w.defaults);
  });

  test('Add site covers the remainder: the held link is drawn on first', async () => {
    const { world, id } = addSite(await heldAt18(5), 'iron-plate', ['b'], 'Plate site');
    const r = await resolve(world);
    const site = r.links.find((l) => l.from === id)!;
    expect(link(r, 'ab')).toMatchObject({ requested: 18, delivered: 18, short: 0 });
    expect(site).toMatchObject({ requested: 12, delivered: 12, short: 0 });
    expect(r.shortfalls).toEqual([]);
    expect(factory(r, id).name).toBe('Plate site');
  });

  test('marking keeps Kept apart, and Hold caps links at the built For links rate', async () => {
    const w = buildWorld(
      [
        { id: 'a', targets: [{ item: 'iron-plate', rate: 0, kept: 10 }] },
        { id: 'b', targets: [{ item: 'reinforced-iron-plate', rate: 3 }] },
      ],
      [pull('ab', 'a', 'b', 'iron-plate')],
    );
    const marked = markBuilt(w, factory(await resolve(w), 'a'), model.meta.dataHash, 'now');
    const a = marked.factories.find((f) => f.id === 'a')!;
    expect(a.built!.outputs).toEqual([{ item: 'iron-plate', rate: 28 }]);
    expect(a.built!.kept).toEqual([{ item: 'iron-plate', rate: 10 }]);
    const more = {
      ...marked,
      factories: marked.factories.map((f) =>
        f.id === 'b'
          ? { ...f, request: { targets: [{ item: 'reinforced-iron-plate', rate: 4 }] } }
          : f,
      ),
    };
    expect(link(await resolve(more), 'ab')).toMatchObject({ requested: 24, delivered: 18 });
  });
});
