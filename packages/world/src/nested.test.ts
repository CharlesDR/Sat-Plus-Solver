import type { Model } from '@sps/data';
import { createHighsBackend, solve } from '@sps/solver';
import { describe, expect, test } from 'vitest';
import vanillaMini from '../../../fixtures/vanilla-mini/model.json';
import { surplusLinkId } from './analytics';
import { markBuilt } from './built';
import type { World } from './document';
import {
  addFactory,
  factoryAncestors,
  factoryDescendants,
  removeFactory,
  setFactoryCollapsed,
  setFactoryParent,
  updateLink,
  wireChild,
  WorldEditError,
} from './editing';
import { extractFactory } from './persist';
import { resolveWorld } from './resolve';
import { buildWorld } from './testing';
import type { LedgerRow, SolveFactory, WorldResult } from './types';

const model = vanillaMini as Model;
const backend = createHighsBackend();
const solveFactory: SolveFactory = (r) => solve(model, r, backend);
const resolve = (w: World) => resolveWorld(w, model, solveFactory);
const of = (r: WorldResult, id: string) => r.factories.find((f) => f.id === id)!;
const row = (rows: readonly LedgerRow[], item: string) => rows.find((x) => x.item === item);

/** produced − consumed + imported + unmet = target + exported + surplus, row by row. */
function conserves(rows: readonly LedgerRow[]): void {
  for (const r of rows) {
    const lhs = r.produced - r.consumed + r.imported + r.unmet;
    const rhs = r.target + r.exported + r.surplus;
    expect(Math.abs(lhs - rhs), r.item).toBeLessThanOrEqual(1e-6 * Math.max(1, lhs, rhs));
  }
}

function conservesEverywhere(r: WorldResult): void {
  conserves(r.ledger);
  for (const f of r.factories) {
    conserves(f.ledger);
    if (f.subtree) conserves(f.subtree.ledger);
  }
}

/** Parent "p" makes Reinforced Iron Plate; "c" is nested in it. */
const family = (childTarget: number) =>
  setFactoryParent(
    buildWorld([
      { id: 'p', targets: [{ item: 'reinforced-iron-plate', rate: 5 }] },
      { id: 'c', targets: [{ item: 'iron-plate', rate: childTarget }] },
    ]),
    'c',
    'p',
  );

describe('nesting edits (A49, A50)', () => {
  test('nesting wires each target to the parent with a pull link', () => {
    const w = family(60);
    expect(w.factories.find((f) => f.id === 'c')!.parentId).toBe('p');
    expect(w.links).toEqual([
      {
        id: 'link-1',
        from: 'c',
        to: 'p',
        item: 'iron-plate',
        mode: { kind: 'pull' },
        nested: true,
      },
    ]);
    // Wiring again adds nothing; a new target is wired on request.
    expect(wireChild(w, 'c')).toBe(w);
    expect(factoryAncestors(w, 'c')).toEqual(['p']);
    expect(factoryDescendants(w, 'p')).toEqual(['c']);
  });

  test('a parent cycle is rejected as an edit', () => {
    let w = family(60);
    w = addFactory(w, 'G', undefined, 'c').world;
    expect(factoryAncestors(w, 'factory-1')).toEqual(['c', 'p']);
    expect(() => setFactoryParent(w, 'p', 'factory-1')).toThrow(WorldEditError);
    expect(() => setFactoryParent(w, 'p', 'p')).toThrow(/inside itself/);
    expect(() => setFactoryParent(w, 'p', 'nope')).toThrow(/Unknown factory/);
  });

  test('un-nesting drops the links nesting made, but not an edited one', () => {
    const w = family(60);
    expect(setFactoryParent(w, 'c', undefined).links).toEqual([]);
    const edited = updateLink(w, 'link-1', {
      from: 'c',
      to: 'p',
      item: 'iron-plate',
      mode: { kind: 'fixed', rate: 30 },
    });
    expect(edited.links[0]!.nested).toBeUndefined();
    expect(setFactoryParent(edited, 'c', undefined).links).toHaveLength(1);
  });

  test('removing a parent moves its sub-factories up, wired to the grandparent', () => {
    let w = family(60);
    const { world, id } = addFactory(w, 'Mid', undefined, 'p');
    w = setFactoryParent(world, 'c', id);
    expect(factoryAncestors(w, 'c')).toEqual([id, 'p']);
    w = removeFactory(w, id);
    expect(w.factories.find((f) => f.id === 'c')!.parentId).toBe('p');
    expect(w.links.filter((l) => l.from === 'c' && l.to === 'p')).toHaveLength(1);
    expect(setFactoryCollapsed(w, 'p', true).factories[0]!.collapsed).toBe(true);
  });
});

describe('nested resolution (A50–A52)', () => {
  test("a child's output reaches its parent through the automatic link, and ledgers conserve", async () => {
    const r = await resolve(family(60));
    expect(r.diagnostics).toEqual([]);
    const p = of(r, 'p');
    const c = of(r, 'c');
    expect(p.status).toBe('ok');
    // The parent needs 30 plates and gets them all from the child.
    expect(row(p.ledger, 'iron-plate')).toMatchObject({ imported: 30, produced: 0 });
    // The child makes its 60, not 60 + 30: what it sends counts toward its target.
    expect(row(c.ledger, 'iron-plate')).toMatchObject({ produced: 60, exported: 30, target: 30 });
    expect(p.children).toEqual(['c']);
    expect(c.parentId).toBe('p');
    expect(p.subtree!.factories).toEqual(['c', 'p']);
    expect(p.subtree!.internalLinks).toEqual(['link-1']);
    expect(p.subtree!.machines).toBe(p.machines + c.machines);
    conservesEverywhere(r);
  });

  test('a child with a smaller target makes what the parent draws', async () => {
    const r = await resolve(family(10));
    expect(row(of(r, 'c').ledger, 'iron-plate')).toMatchObject({
      produced: 30,
      exported: 30,
      target: 0,
    });
    conservesEverywhere(r);
  });

  test("the parent draws on a child's surplus with no link", async () => {
    // Plastic leaves Heavy Oil Residue over; the parent asks for some.
    const w = setFactoryParent(
      buildWorld([
        { id: 'p', targets: [{ item: 'heavy-oil-residue', rate: 5 }] },
        {
          id: 'c',
          targets: [{ item: 'plastic', rate: 20 }],
          request: { avoidFluidByproducts: false },
        },
      ]),
      'c',
      'p',
    );
    const r = await resolve(w);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const draw = r.links.find((l) => l.id === surplusLinkId('c', 'heavy-oil-residue'));
    expect(draw).toMatchObject({ from: 'c', to: 'p', mode: 'surplus', delivered: 5, short: 0 });
    expect(row(of(r, 'p').ledger, 'heavy-oil-residue')).toMatchObject({ imported: 5, unmet: 0 });
    expect(row(of(r, 'c').ledger, 'heavy-oil-residue')).toMatchObject({ exported: 5, surplus: 5 });
    expect(of(r, 'p').extraction).toEqual([]);
    conservesEverywhere(r);
  });

  test('the build state rolls up to the worst in the subtree', async () => {
    let w = family(60);
    w = markBuilt(w, of(await resolve(w), 'c'), model.meta.dataHash, 'now');
    expect(of(await resolve(w), 'p').subtreeBuild).toBe('matches');
    w = {
      ...w,
      factories: w.factories.map((f) =>
        f.id === 'c' ? { ...f, request: { targets: [{ item: 'iron-plate', rate: 90 }] } } : f,
      ),
    };
    const r = await resolve(w);
    expect(of(r, 'p').subtreeBuild).toBe('broken');
    expect(of(r, 'p').build).toBeUndefined();
  });

  test('a parent cycle in a loaded world is reported and broken', async () => {
    const w = buildWorld([{ id: 'a' }, { id: 'b' }]);
    w.factories[0]!.parentId = 'b';
    w.factories[1]!.parentId = 'a';
    const r = await resolve(w);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['invalid-parent']);
    expect(of(r, 'a').parentId).toBe('b');
  });

  test('a shared sub-factory makes the larger of its target and what it sends', () => {
    const w = family(60);
    const f = extractFactory(w, 'c', { 'link-1': 30 }).factories[0]!;
    expect(f.request.targets).toEqual([{ item: 'iron-plate', rate: 60 }]);
    expect(f.parentId).toBeUndefined();
    const g = extractFactory(w, 'c', { 'link-1': 80 }).factories[0]!;
    expect(g.request.targets).toEqual([{ item: 'iron-plate', rate: 80 }]);
  });
});
