/**
 * DF-1 (A98) on the SF+ model: a factory's miners use the best drill its Max
 * tier unlocks, with full boosters, and take their share of the node pool.
 */
import type { Model } from '@sps/data';
import {
  compareTiers,
  createHighsBackend,
  solve,
  type SolveRequest,
  type SolveResult,
} from '@sps/solver';
import { createFactory, createWorld, resolveWorld } from '@sps/world';
import { beforeAll, describe, expect, test } from 'vitest';
import { runPipeline } from './build-data';

const backend = createHighsBackend();
let model: Model;

beforeAll(async () => {
  model = (await runPipeline()).result.model!;
}, 120_000);

/** The value the Max tier select stores for "T<major>": the major's highest tier. */
const tierFor = (major: number) =>
  [...new Set(model.recipes.map((r) => r.tier))]
    .filter((t) => t.startsWith(`${major}-`))
    .sort(compareTiers)
    .at(-1)!;

const routesOf = (r: SolveResult) =>
  r.recipes.map((u) => model.recipes.find((x) => x.id === u.id)!).filter((x) => x.route);

const siterite = (maxTier?: string) =>
  solve(
    model,
    {
      targets: [{ item: 'siterite-ore', rate: 480 }],
      ...(maxTier ? { recipes: { maxTier } } : {}),
    },
    backend,
  );

describe('miner output follows the Max tier (DF-1)', () => {
  test('T2 plans Mk.1 miners, with no Fluid or Crusher module', async () => {
    const r = await siterite(tierFor(2));
    expect(r.status).toBe('ok');
    const routes = routesOf(r);
    expect(routes.length).toBeGreaterThan(0);
    for (const x of routes) {
      expect(x.route!.mk).toBe(1);
      expect(x.route!.fluid).toBeNull();
      expect(model.machines.find((m) => m.id === x.machine)!.name).not.toMatch(/Crusher|Fluid/);
    }
    // Each node class counts one node per miner here, and a quarter of one in the pool.
    expect(r.nodes.length).toBeGreaterThan(0);
    for (const n of r.nodes) expect(n.used).toBeCloseTo(n.occupied * 0.25, 9);
  });

  test.each([
    [4, 2],
    [8, 3],
  ])('T%i plans Mk.%i miners', async (major, mk) => {
    const r = await siterite(tierFor(major));
    expect(r.status).toBe('ok');
    const drills = new Set(routesOf(r).map((x) => x.route!.mk));
    expect([...drills]).toEqual([mk]);
  });

  test('no Max tier plans Mk.3 miners on their best-drill ids, one node each', async () => {
    const r = await siterite();
    expect(r.status).toBe('ok');
    for (const x of routesOf(r)) {
      expect(x.route!.mk).toBe(3);
      expect(x.family).toBeUndefined();
    }
    for (const n of r.nodes) expect(n.used).toBeCloseTo(n.occupied, 9);
  });

  test('a toggle on a best-drill id turns the route off at every drill', async () => {
    const r = await siterite(tierFor(2));
    const used = routesOf(r).map((x) => x.family!);
    const off = await solve(
      model,
      {
        targets: [{ item: 'siterite-ore', rate: 480 }],
        recipes: { maxTier: tierFor(2), exclude: used },
      },
      backend,
    );
    expect(routesOf(off).some((x) => used.includes(x.family!))).toBe(false);
  });

  test('world node totals count node shares (DF-1)', async () => {
    const w = createWorld(model.meta.dataHash);
    const f = createFactory('t2', 'T2 mine');
    f.request = { targets: [{ item: 'siterite-ore', rate: 480 }], maxTier: tierFor(2) };
    w.factories = [f];
    const r = await resolveWorld(w, model, (q: SolveRequest) => solve(model, q, backend));
    const plan = r.factories[0]!;
    expect(plan.status).toBe('ok');
    const used = r.nodePool.filter((n) => n.used > 0);
    expect(used.length).toBeGreaterThan(0);
    for (const n of used)
      expect(n.used).toBeCloseTo(plan.nodes.find((u) => u.node === n.node)!.used, 9);
    const solved = await siterite(tierFor(2));
    const shares = solved.nodes.reduce((s, n) => s + n.used, 0);
    expect(used.reduce((s, n) => s + n.used, 0)).toBeCloseTo(shares, 9);
    expect(shares).toBeCloseTo(solved.nodes.reduce((s, n) => s + n.occupied, 0) / 4, 9);
  });
});
