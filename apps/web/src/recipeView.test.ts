import type { Model } from '@sps/data';
import { addTweak, createFactory, createWorld, DEFAULT_FACTORY_ID } from '@sps/world';
import { describe, expect, test } from 'vitest';
import miniJson from '../../../fixtures/vanilla-mini/model.json';
import { recipeRows } from './recipeView';
import { modelCatalog } from './solver/service';

const mini = miniJson as unknown as Model;
const recipes = modelCatalog({
  ...mini,
  recipes: mini.recipes.map((r) => (r.id === 'steel-beam' ? { ...r, tier: '3-1' } : r)),
}).recipes;
const F = DEFAULT_FACTORY_ID;
const row = (rows: ReturnType<typeof recipeRows>, id: string) =>
  rows.find((r) => r.recipe.id === id);

describe('recipe rows', () => {
  test('a plan tweak shows as tweaked, with the state it gives (A35)', () => {
    let w = addTweak(createWorld(), F, { kind: 'swap', from: 'screw', to: 'cast-screw' });
    w = addTweak(w, F, { kind: 'ban', recipe: 'iron-rod' });
    const rows = recipeRows(w, { kind: 'factory', id: F }, recipes);
    expect(row(rows, 'screw')).toMatchObject({ on: false, reason: 'excluded', tweaked: true });
    expect(row(rows, 'cast-screw')).toMatchObject({ on: true, tweaked: true });
    expect(row(rows, 'iron-rod')).toMatchObject({ on: false, tweaked: true });
    expect(row(rows, 'iron-plate')!.tweaked).toBeUndefined();
  });

  test('standard on, alternates off by default', () => {
    const rows = recipeRows(createWorld(), { kind: 'factory', id: F }, recipes);
    expect(rows).toHaveLength(recipes.length);
    expect(row(rows, 'screw')).toEqual({ recipe: expect.anything(), key: 'screw', on: true });
    expect(row(rows, 'cast-screw')).toMatchObject({ on: false, reason: 'alternate' });
  });

  test('a factory toggle wins over the world, which wins over the default', () => {
    const w = createWorld();
    w.factories.push(createFactory('b', 'B'));
    w.defaults.recipes = { 'cast-screw': true, screw: false };
    w.factories[0]!.request.recipes = { screw: true };
    const here = recipeRows(w, { kind: 'factory', id: F }, recipes);
    expect(row(here, 'screw')).toMatchObject({ on: true, toggle: true, inherited: false });
    expect(row(here, 'cast-screw')).toMatchObject({ on: true, inherited: true });
    expect(row(here, 'cast-screw')).not.toHaveProperty('toggle');
    const b = recipeRows(w, { kind: 'factory', id: 'b' }, recipes);
    expect(row(b, 'screw')).toMatchObject({ on: false, reason: 'excluded', inherited: false });
    const world = recipeRows(w, { kind: 'world' }, recipes);
    expect(row(world, 'screw')).toMatchObject({ on: false, toggle: false });
    expect(row(world, 'screw')).not.toHaveProperty('inherited');
  });

  test('the max tier marks recipes above it', () => {
    const w = createWorld();
    w.factories[0]!.request.maxTier = '3-0';
    w.factories[0]!.request.recipes = { 'steel-beam': true };
    const rows = recipeRows(w, { kind: 'factory', id: F }, recipes);
    expect(row(rows, 'steel-beam')).toMatchObject({ on: false, reason: 'tier' });
    expect(row(recipeRows(w, { kind: 'world' }, recipes), 'steel-beam')?.on).toBe(true);
  });

  test('a miner route shows at the drill the max tier unlocks; its toggle covers every drill (DF-1)', () => {
    const top = { ...recipes.find((r) => r.id === 'screw')!, id: 'mine:ore', tier: '8-2' };
    const mk1 = { ...top, id: 'mine:ore:mk1', tier: '0-5', supersededAt: '4-3', family: top.id };
    const list = [mk1, top];
    const w = createWorld();
    w.factories[0]!.request.maxTier = '2-0';
    const t2 = recipeRows(w, { kind: 'factory', id: F }, list);
    expect(row(t2, 'mine:ore:mk1')).toMatchObject({ key: 'mine:ore', on: true });
    expect(row(t2, 'mine:ore')).toMatchObject({ on: false, reason: 'tier' });
    // With no max tier the best drill runs and the Mk.1 route is not listed.
    const open = recipeRows(createWorld(), { kind: 'factory', id: F }, list);
    expect(open.map((r) => r.recipe.id)).toEqual(['mine:ore']);
    // A toggle saved on the best-drill id turns the Mk.1 route off too.
    w.factories[0]!.request.recipes = { 'mine:ore': false };
    const off = recipeRows(w, { kind: 'factory', id: F }, list);
    expect(row(off, 'mine:ore:mk1')).toMatchObject({
      on: false,
      reason: 'excluded',
      toggle: false,
    });
  });

  test('search and views filter the list', () => {
    const w = createWorld();
    w.factories[0]!.request.recipes = { wire: false };
    const scope = { kind: 'factory', id: F } as const;
    const ids = (search: string, view?: Parameters<typeof recipeRows>[4]) =>
      recipeRows(w, scope, recipes, search, view).map((r) => r.recipe.id);
    // By product name and by several words.
    expect(ids('screw')).toEqual(expect.arrayContaining(['screw', 'cast-screw']));
    expect(ids('cast screw')).toEqual(['cast-screw']);
    expect(ids('', 'alternates').sort()).toEqual(['cast-screw', 'iron-wire', 'solid-steel-ingot']);
    expect(ids('', 'changed')).toEqual(['wire']);
    expect(ids('wire', 'off').sort()).toEqual(['iron-wire', 'wire']);
    expect(ids('wire', 'on')).toEqual([]);
    expect(ids('', 'standard')).not.toContain('cast-screw');
  });

  test('an unknown factory throws', () => {
    expect(() => recipeRows(createWorld(), { kind: 'factory', id: 'nope' }, recipes)).toThrow();
  });
});
