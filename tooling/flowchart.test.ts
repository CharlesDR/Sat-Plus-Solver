/**
 * Factory flowchart on the full SF+ model (PLAN M7 acceptance): edge rates
 * conserve, a Converter-loop plan lays out without overlap, and a 150-node
 * plan lays out in under 2 s.
 */
import type { Model } from '@sps/data';
import {
  factoryGraph,
  GASES,
  layoutFactoryGraph,
  overlaps,
  type FactoryGraph,
  type GraphLabels,
} from '@sps/graph';
import { createHighsBackend, solve, type SolveRequest } from '@sps/solver';
import ELK from 'elkjs/lib/elk.bundled.js';
import { beforeAll, describe, expect, test } from 'vitest';
import { runPipeline } from './build-data';

function expectConserved(g: FactoryGraph) {
  const sum = new Map<string, number>();
  const add = (k: string, v: number) => sum.set(k, (sum.get(k) ?? 0) + v);
  for (const e of g.edges) {
    add(`${e.source} out ${e.item}`, e.rate);
    add(`${e.target} in ${e.item}`, e.rate);
  }
  for (const n of g.nodes) {
    for (const f of n.inputs)
      expect(Math.abs((sum.get(`${n.id} in ${f.item}`) ?? 0) - f.rate)).toBeLessThanOrEqual(
        1e-6 * Math.max(1, f.rate),
      );
    for (const f of n.outputs)
      expect(Math.abs((sum.get(`${n.id} out ${f.item}`) ?? 0) - f.rate)).toBeLessThanOrEqual(
        1e-6 * Math.max(1, f.rate),
      );
  }
}

/** Whether the edges form a directed cycle through recipe nodes. */
function hasCycle(g: FactoryGraph): boolean {
  const next = new Map<string, string[]>();
  for (const e of g.edges)
    if (e.source !== e.target) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    if (state.get(n) === 1) return true;
    if (state.get(n) === 2) return false;
    state.set(n, 1);
    const found = (next.get(n) ?? []).some(visit);
    state.set(n, 2);
    return found;
  };
  return g.nodes.some((n) => visit(n.id));
}

describe('factory flowchart on the SF+ model', () => {
  let model: Model;
  let labels: GraphLabels;
  const backend = createHighsBackend();
  const graphOf = async (request: SolveRequest) => {
    const r = await solve(model, request, backend);
    expect(r.status).toBe('ok');
    return factoryGraph(r, labels);
  };

  beforeAll(async () => {
    const { result } = await runPipeline();
    model = result.model!;
    const item = new Map(model.items.map((i) => [i.id, i.name]));
    const machine = new Map(model.machines.map((m) => [m.id, m.name]));
    labels = { item: (id) => item.get(id), machine: (id) => machine.get(id) };
  }, 120_000);

  test('a Converter loop (Coal from Reanimated SAM) renders without overlap', async () => {
    // With SAM free to import, Converters turn Coal into Larrussite, Callanite
    // and back into more Coal: the plan is a loop.
    const g = await graphOf({
      targets: [{ item: 'coal', rate: 240 }],
      imports: [{ item: 'reanimated-sam', cap: Infinity }],
    });
    expect(hasCycle(g)).toBe(true);
    const converters = g.nodes.filter((n) => n.machine === 'Converter');
    expect(converters.length).toBeGreaterThanOrEqual(3);
    expectConserved(g);
    const a = await layoutFactoryGraph(g, new ELK());
    expect(overlaps(a)).toEqual([]);
    // Deterministic: a fresh engine gives the same layout.
    expect(await layoutFactoryGraph(structuredClone(g), new ELK())).toEqual(a);
  }, 60_000);

  test('a 150-node plan lays out in under 2 s', async () => {
    const g = await graphOf({
      targets: [{ item: 'ballistic-warp-drive', rate: 1 }],
      recipes: { alternates: true },
      // A layout benchmark: keep the plan's full size, slivers included (A34).
      minBranch: 0,
    });
    expect(g.nodes.length).toBeGreaterThanOrEqual(150);
    expectConserved(g);
    const elk = new ELK();
    // Warm the engine up (the app keeps one alive) so the timing is the layout itself.
    await layoutFactoryGraph({ nodes: g.nodes.slice(0, 1), edges: [] }, elk);
    const t0 = performance.now();
    const layout = await layoutFactoryGraph(g, elk);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(overlaps(layout)).toEqual([]);
    // Every line is drawn square: no slanted segment (A46).
    for (const e of layout.edges)
      for (let k = 1; k < e.points.length; k++) {
        const a = e.points[k - 1]!;
        const b = e.points[k]!;
        expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(1e-6);
      }
  }, 60_000);

  test('every listed gas is a fluid in the model (A48)', () => {
    const fluids = new Set(model.items.filter((i) => i.form === 'fluid').map((i) => i.id));
    for (const gas of GASES) expect(fluids, gas).toContain(gas);
  });

  test('heater edges follow the heater rule: Steam 20/min burns a whole heater (A17)', async () => {
    const r = await solve(model, { targets: [{ item: 'steam', rate: 20 }] }, backend);
    const g = factoryGraph(r, labels);
    expectConserved(g);
    const heater = g.nodes.find((n) => n.boilerLoad !== undefined)!;
    expect(Number.isInteger(heater.machines)).toBe(true);
    const id = heater.recipe!;
    const fuel = model.recipes.find((x) => x.id === id)!.inputs.filter((f) => f.heater);
    expect(fuel.length).toBeGreaterThan(0);
    expect(heater.boilerLoad!).toBeLessThan(1);
    for (const f of fuel) {
      // The full per-heater rate times whole heaters, not scaled by the boiler load.
      const into = g.edges.filter((e) => e.target === heater.id && e.item === f.item);
      expect(into.reduce((s, e) => s + e.rate, 0)).toBeCloseTo(f.rate * heater.machines!, 6);
    }
  }, 60_000);
});
