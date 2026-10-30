import type { Model } from '@sps/data';
import { worldGraph } from '@sps/graph';
import { createHighsBackend } from '@sps/solver';
import {
  addFactory,
  addGroup,
  addLink,
  createWorld,
  setFactoryGroup,
  setFactoryParent,
  type World,
} from '@sps/world';
import { beforeAll, describe, expect, test } from 'vitest';
import miniJson from '../../../../fixtures/vanilla-mini/model.json';
import type { WorldSummary } from '../solver/protocol';
import { createSolverService, modelCatalog } from '../solver/service';
import {
  breadcrumb,
  carriersFor,
  ledgerFor,
  ledgerScopes,
  powerRows,
  fixedDefault,
  productsOf,
  spareFrom,
  sumPower,
  traceableItems,
  worldStatus,
} from './viewModel';

const mini = miniJson as unknown as Model;
const catalog = modelCatalog(mini);

/** A pulls Iron Plate to B (3 RIP/min); P is a coal power plant at 75 MW; A and B in "Iron". */
function sample(): World {
  let w = createWorld('vanilla-mini');
  w = { ...w, factories: [] };
  const a = addFactory(w, 'A');
  const b = addFactory(a.world, 'B');
  const p = addFactory(b.world, 'P');
  const g = addGroup(p.world, 'Iron');
  w = setFactoryGroup(setFactoryGroup(g.world, a.id, g.id), b.id, g.id);
  w = addLink(w, { from: a.id, to: b.id, item: 'iron-plate', mode: { kind: 'pull' } }).world;
  const targets: Record<string, { item: string; rate: number }[]> = {
    [b.id]: [{ item: 'reinforced-iron-plate', rate: 3 }],
    [p.id]: [{ item: 'mw', rate: 75 }],
  };
  return {
    ...w,
    factories: w.factories.map((f) => ({ ...f, request: { targets: targets[f.id] ?? [] } })),
  };
}

let world: World;
let summary: WorldSummary;
beforeAll(async () => {
  world = sample();
  const service = createSolverService(mini, createHighsBackend());
  summary = (await service.solve({ world })).world;
});

describe('power panel', () => {
  test('the total equals the sum of the factory power values', () => {
    const { factories, groups, total } = powerRows(summary);
    expect(factories.map((r) => r.label)).toEqual(['A', 'B', 'P']);
    const sum = sumPower(factories);
    expect(total.power.consumptionMW).toBeCloseTo(sum.consumptionMW, 9);
    expect(total.power.generationMW).toBeCloseTo(sum.generationMW, 9);
    expect(total.power.netMW).toBeCloseTo(sum.netMW, 9);
    expect(sum.generationMW).toBeCloseTo(75, 9);
    // A group row is the sum of its factories.
    const iron = groups.find((r) => r.label === 'Iron')!;
    expect(iron.power.consumptionMW).toBeCloseTo(
      factories[0]!.power.consumptionMW + factories[1]!.power.consumptionMW,
      9,
    );
  });
});

describe('ledger', () => {
  test('scopes: the save, each group, each factory', () => {
    expect(ledgerScopes(summary).map((s) => s.label)).toEqual([
      'Whole save',
      'Group: Iron',
      'Factory: A',
      'Factory: B',
      'Factory: P',
    ]);
    const a = ledgerFor(summary, { kind: 'factory', id: 'factory-1' });
    const b = ledgerFor(summary, { kind: 'factory', id: 'factory-2' });
    expect(a.find((r) => r.item === 'iron-plate')).toMatchObject({ exported: 18 });
    expect(b.find((r) => r.item === 'iron-plate')).toMatchObject({ imported: 18 });
    // Inside the group the link is internal: nothing crosses its boundary.
    const iron = ledgerFor(summary, { kind: 'group', id: 'group-1' });
    expect(iron.find((r) => r.item === 'iron-plate')).toMatchObject({ imported: 0, exported: 0 });
    expect(ledgerFor(summary, { kind: 'group', id: 'gone' })).toEqual([]);
  });

  test('trace and link-item suggestions come from the flows', () => {
    expect(traceableItems(summary)).toContain('iron-plate');
    expect(traceableItems(summary)).not.toContain('mw');
    // Ore's products are what it ships, not the ore and ingots it uses up.
    expect(productsOf(summary, 'factory-1')).toEqual(['iron-plate']);
    expect(productsOf(undefined, 'factory-1')).toEqual([]);
  });
});

describe('link defaults (DF-4)', () => {
  const summary = {
    factories: [
      {
        id: 'f',
        targets: [{ item: 'plastic', forLinks: 20, kept: 0, spare: 12.5 }],
        ledger: [
          { item: 'plastic', surplus: 0 },
          { item: 'heavy-oil-residue', surplus: 10.0049 },
        ],
      },
    ],
  } as unknown as WorldSummary;

  test('spare: a target’s untaken For links, else its surplus', () => {
    expect(spareFrom(summary, 'f', 'plastic')).toBe(12.5);
    expect(spareFrom(summary, 'f', 'heavy-oil-residue')).toBe(10.0049);
    expect(spareFrom(summary, 'f', 'rubber')).toBe(0);
    expect(spareFrom(undefined, 'f', 'plastic')).toBe(0);
  });

  test('a fixed default never asks for more: rounded down to 0.01/min', () => {
    expect(fixedDefault(10.0049)).toBe(10);
    expect(fixedDefault(12.5)).toBe(12.5);
    expect(fixedDefault(1 / 3)).toBe(0.33);
    expect(fixedDefault(0.29)).toBe(0.29);
    expect(fixedDefault(0.004)).toBe(0);
  });
});

describe('navigation and transport', () => {
  test('breadcrumb names the groups from the top down', () => {
    const inner = addGroup(world, 'Plates', 'group-1');
    const w = setFactoryGroup(inner.world, 'factory-2', inner.id);
    expect(breadcrumb(w, 'factory-2')).toEqual({
      groups: ['Iron', 'Plates'],
      parents: [],
      factory: 'B',
    });
    expect(breadcrumb(w, 'factory-3')).toEqual({ groups: [], parents: [], factory: 'P' });
  });

  test("a sub-factory's breadcrumb names its parents, inside the top parent's groups (A49)", () => {
    const inner = addGroup(world, 'Plates', 'group-1');
    let w = setFactoryGroup(inner.world, 'factory-2', inner.id);
    w = setFactoryParent(w, 'factory-3', 'factory-2');
    const sub = addFactory(w, 'Deep', undefined, 'factory-3');
    expect(breadcrumb(sub.world, sub.id)).toEqual({
      groups: ['Iron', 'Plates'],
      parents: [
        { id: 'factory-2', name: 'B' },
        { id: 'factory-3', name: 'P' },
      ],
      factory: 'Deep',
    });
  });

  test('belt and pipe counts use the dataset belts and the A10 pipes', () => {
    expect(carriersFor(catalog, { kind: 'belt', tier: 1 }, 61)).toBe(2);
    expect(carriersFor(catalog, { kind: 'belt', tier: 1 }, 60)).toBe(1);
    expect(carriersFor(catalog, { kind: 'pipe', tier: 2 }, 900)).toBe(2);
    expect(carriersFor(catalog, { kind: 'train' }, 900)).toBeUndefined();
    expect(carriersFor(catalog, { kind: 'belt' }, 900)).toBeUndefined();
    expect(carriersFor(catalog, { kind: 'belt', tier: 2 }, 0)).toBe(0);
  });
});

describe('item trace on a solved world', () => {
  test('marks exactly the factories, collapsed groups and links whose flows touch the item', () => {
    const items = summary.ledger.map((r) => r.item);
    for (const collapsed of [[], ['group-1']])
      for (const item of items) {
        const g = worldGraph(summary, { collapsed, traceItem: item });
        for (const n of g.nodes) {
          if (n.kind === 'group' && !n.collapsed) continue;
          const ledger =
            n.kind === 'factory'
              ? summary.factories.find((f) => f.id === n.ref)!.ledger
              : summary.groups.find((x) => x.id === n.ref)!.ledger;
          const touches = ledger.some(
            (r) =>
              r.item === item &&
              [r.produced, r.consumed, r.target, r.imported, r.exported, r.surplus, r.unmet].some(
                (v) => Math.abs(v) > 1e-6,
              ),
          );
          expect([item, n.id, n.traced]).toEqual([item, n.id, touches]);
        }
        for (const e of g.edges.filter((x) => x.kind === 'link'))
          expect([item, e.id, e.traced]).toEqual([
            item,
            e.id,
            e.items.some((i) => i.item === item),
          ]);
      }
    const plates = worldGraph(summary, { traceItem: 'iron-plate' });
    expect(plates.nodes.filter((n) => n.traced).map((n) => n.id)).toEqual([
      'factory:factory-1',
      'factory:factory-2',
    ]);
    expect(plates.edges.filter((e) => e.traced).map((e) => e.id)).toEqual([
      'factory:factory-1→factory:factory-2',
    ]);
  });
});

describe('world status chip (B4, A75)', () => {
  const summary = (statuses: string[], deficitMW = 0, unmet: number[] = []): WorldSummary =>
    ({
      factories: statuses.map((status, k) => ({ id: `f${k}`, status })),
      ledger: unmet.map((u, k) => ({ item: `i${k}`, unmet: u })),
      power: { consumptionMW: 0, generationMW: 0, netMW: deficitMW, deficitMW },
    }) as unknown as WorldSummary;

  test('ok, empty, then problems worst first', () => {
    expect(worldStatus(summary(['ok', 'empty']))).toEqual({ status: 'ok', label: 'World ok' });
    expect(worldStatus(summary(['empty']))).toEqual({ status: 'empty', label: 'World empty' });
    expect(worldStatus(summary(['ok', 'short'], 0, [0, 2]))).toEqual({
      status: 'short',
      label: '1 short · 1 unmet import',
    });
    expect(worldStatus(summary(['ok', 'short'], 1205.02))).toEqual({
      status: 'infeasible',
      label: 'Deficit 1,206 MW · 1 short',
    });
    expect(worldStatus(summary(['infeasible', 'infeasible'])).label).toBe('2 factories failed');
  });
});
