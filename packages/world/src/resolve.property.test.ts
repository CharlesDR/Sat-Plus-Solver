/**
 * World properties (docs/ARCHITECTURE.md §9) over random worlds on the
 * vanilla-mini model, DAGs and cycles alike. Fixed seed keeps CI deterministic.
 */
import type { Model } from '@sps/data';
import { createHighsBackend, solve, type PowerSummary } from '@sps/solver';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import type { Group, Link, World } from './document';
import { resolveWorld } from './resolve';
import { buildWorld, type FactorySpec } from './testing';
import type { LedgerRow, ScopeTotals, WorldResult } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();
const SEED = 20261001;
const RUNS = 40;
const TOL = 1e-6;

const ITEMS = [
  'iron-ingot',
  'iron-plate',
  'iron-rod',
  'screw',
  'reinforced-iron-plate',
  'copper-ingot',
  'wire',
  'cable',
  'concrete',
  'steel-beam',
];

const worldArb = fc
  .integer({ min: 2, max: 6 })
  .chain((n) => {
    const ids = Array.from({ length: n }, (_, k) => `f${k}`);
    const factory = fc.record({
      target: fc.option(
        fc.record({
          item: fc.constantFrom(...ITEMS),
          rate: fc.integer({ min: 1, max: 120 }),
        }),
        { nil: undefined },
      ),
      group: fc.option(fc.constantFrom('g0', 'g1', 'g2'), { nil: undefined }),
      // One factory in five has no nodes: it fails unless its links feed it.
      starved: fc.integer({ min: 0, max: 4 }).map((k) => k === 0),
    });
    const link = fc.record({
      from: fc.constantFrom(...ids),
      to: fc.constantFrom(...ids),
      item: fc.constantFrom(...ITEMS),
      rate: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 60 })),
    });
    return fc.record({
      factories: fc.array(factory, { minLength: n, maxLength: n }),
      links: fc.array(link, { maxLength: 8 }),
      nested: fc.boolean(),
    });
  })
  .map(({ factories, links, nested }) => {
    const specs: FactorySpec[] = factories.map((f, k) => ({
      id: `f${k}`,
      ...(f.target ? { targets: [f.target] } : {}),
      ...(f.group ? { group: f.group } : {}),
      ...(f.starved ? { nodeBudget: {} } : {}),
    }));
    const ls: Link[] = links
      .filter((l) => l.from !== l.to)
      .map((l, k) => ({
        id: `l${k}`,
        from: l.from,
        to: l.to,
        item: l.item,
        mode: l.rate === undefined ? { kind: 'pull' } : { kind: 'fixed', rate: l.rate },
      }));
    const groups: Group[] = [
      { id: 'g0', name: 'G0', collapsed: false },
      { id: 'g1', name: 'G1', collapsed: false, ...(nested ? { parentId: 'g0' } : {}) },
      { id: 'g2', name: 'G2', collapsed: true, ...(nested ? { parentId: 'g1' } : {}) },
    ];
    return buildWorld(specs, ls, groups);
  });

const close = (a: number, b: number) =>
  Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b));

function conserves(rows: readonly LedgerRow[]): string[] {
  return rows
    .filter(
      (r) =>
        !close(r.produced - r.consumed + r.imported + r.unmet, r.target + r.exported + r.surplus),
    )
    .map((r) => r.item);
}

const property = (check: (r: WorldResult, world: World) => void) =>
  fc.asyncProperty(worldArb, async (world) => {
    const r = await resolveWorld(world, model, (req) => solve(model, req, backend));
    check(r, world);
  });

describe('world properties (§9)', () => {
  test('conservation: every item balances in every factory, group and the save', async () => {
    await fc.assert(
      property((r) => {
        expect(conserves(r.ledger)).toEqual([]);
        for (const s of [...r.factories, ...r.groups])
          expect([s.id, conserves(s.ledger)]).toEqual([s.id, []]);
        // The save has no boundary.
        for (const row of r.ledger)
          expect([row.item, row.imported, row.exported]).toEqual([row.item, 0, 0]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  test('link delivery ≤ request, and equals it when the producer solved', async () => {
    await fc.assert(
      property((r, world) => {
        const rates = new Map(
          world.links.map((l) => [l.id, l.mode.kind === 'fixed' ? l.mode.rate : undefined]),
        );
        for (const l of r.links) {
          expect(l.delivered).toBeLessThanOrEqual(l.requested);
          const producer = r.factories.find((f) => f.id === l.from)!;
          if (producer.status !== 'infeasible') expect(l.delivered).toBe(l.requested);
          // A fixed link always asks its rate, whatever the consumer draws.
          if (l.mode === 'fixed') expect(l.requested).toBe(rates.get(l.id));
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  test('pull resolution reaches a fixed point unless a cycle is reported', async () => {
    await fc.assert(
      property((r) => {
        const unsettled = new Set(
          r.diagnostics.flatMap((d) => (d.code === 'cycle-not-converged' ? d.links : [])),
        );
        for (const l of r.links)
          if (l.mode === 'pull' && !unsettled.has(l.id))
            expect([l.id, close(l.used, l.requested) || l.requested === 0]).toEqual([l.id, true]);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  test('a factory’s own targets are untouched by its links', async () => {
    await fc.assert(
      property((r) => {
        for (const f of r.factories) {
          if (f.status === 'infeasible') continue;
          const own = new Map<string, number>();
          for (const t of f.result.items) own.set(t.item, 0);
          const world = f.request.targets;
          for (const t of world) own.set(t.item, (own.get(t.item) ?? 0) + t.rate);
          for (const row of f.ledger)
            expect([row.item, close(row.target, own.get(row.item) ?? 0)]).toEqual([row.item, true]);
        }
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });

  test('group aggregate = Σ descendants', async () => {
    await fc.assert(
      property((r) => {
        for (const g of r.groups) {
          const members = r.factories.filter((f) => g.factories.includes(f.id));
          expectSum(g, members);
        }
        expectSum({ ...r, power: r.power }, r.factories);
      }),
      { numRuns: RUNS, seed: SEED },
    );
  });
});

/** Additive totals of a scope equal the sum over its factories (imports/exports differ by internal links). */
function expectSum(scope: ScopeTotals, members: readonly ScopeTotals[]): void {
  const sum = (f: (s: ScopeTotals) => number) => members.reduce((t, m) => t + f(m), 0);
  const power = (k: keyof PowerSummary) => sum((m) => m.power[k]);
  expect(close(scope.power.consumptionMW, power('consumptionMW'))).toBe(true);
  expect(close(scope.power.generationMW, power('generationMW'))).toBe(true);
  expect(scope.machines).toBe(sum((m) => m.machines));
  const items = new Set([...scope.ledger, ...members.flatMap((m) => m.ledger)].map((r) => r.item));
  for (const item of items) {
    const field = (s: ScopeTotals, k: keyof LedgerRow) =>
      Number(s.ledger.find((r) => r.item === item)?.[k] ?? 0);
    for (const k of ['produced', 'consumed', 'target', 'surplus', 'unmet'] as const)
      expect([
        item,
        k,
        close(
          field(scope, k),
          sum((m) => field(m, k)),
        ),
      ]).toEqual([item, k, true]);
  }
  const nodes = new Set([...scope.nodes, ...members.flatMap((m) => m.nodes)].map((n) => n.node));
  for (const node of nodes) {
    const used = (s: ScopeTotals) => s.nodes.find((n) => n.node === node)?.used ?? 0;
    expect(close(used(scope), sum(used))).toBe(true);
  }
}
