import { expect, test } from 'vitest';
import { productionDepths, productionOrder, type OrderedRecipe } from './order';

const r = (id: string, inputs: string[], outputs: string[], name = id): OrderedRecipe => ({
  id,
  name,
  inputs: inputs.map((item) => ({ item })),
  outputs: outputs.map((item) => ({ item })),
});

test('raw end first, targets last, ties by name (UX-B)', () => {
  const recipes = [
    r('plate', ['ingot'], ['plate'], 'Iron Plate'),
    r('rod', ['ingot'], ['rod'], 'Iron Rod'),
    r('screw', ['rod'], ['screw'], 'Screw'),
    r('ingot', ['ore'], ['ingot'], 'Iron Ingot'),
    r('ore', [], ['ore'], 'Iron Ore'),
    r('rip', ['plate', 'screw'], ['rip'], 'Reinforced Iron Plate'),
  ];
  expect(productionOrder(recipes).map((x) => x.id)).toEqual([
    'ore',
    'ingot',
    'plate',
    'rod',
    'screw',
    'rip',
  ]);
  // The longest chain counts: the plate is 2 deep, the screw 3, so RIP is 4.
  expect(productionDepths(recipes).get('rip')).toBe(4);
});

test('extraction recipes are raw, even when they take a fluid made in the plan', () => {
  const miner = { ...r('miner', ['acid'], ['ore']), node: 'ore-node' };
  const d = productionDepths([
    miner,
    r('crush', ['ore'], ['crushed']),
    r('acid', ['crushed'], ['acid']),
  ]);
  expect(d.get('miner')).toBe(0);
  expect(d.get('acid')).toBe(2);
});

test('recipes fed only by imports start at depth 0', () => {
  expect(productionDepths([r('plate', ['ingot'], ['plate'])]).get('plate')).toBe(0);
});

test('a loop breaks at the line that closes it, and does not hang', () => {
  const recipes = [
    r('breed', ['slug', 'feed'], ['slug']),
    r('feed', ['ore'], ['feed']),
    r('ore', [], ['ore']),
    r('a', ['b-out', 'ore'], ['a-out']),
    r('b', ['a-out'], ['b-out']),
    r('use', ['a-out', 'slug'], ['target']),
  ];
  const d = productionDepths(recipes);
  expect(d.get('b')).toBe(0);
  expect(d.get('a')).toBe(1);
  expect(d.get('breed')).toBe(2);
  expect(d.get('use')).toBe(3);
});

test('water back from a turbine does not pull the water users after it', () => {
  const recipes = [
    r('water', [], ['water']),
    r('miner', ['water'], ['ore']),
    r('wash', ['ore', 'water'], ['crushed', 'tailings']),
    r('filter', ['tailings'], ['crushed']),
    r('molten', ['crushed'], ['molten']),
    r('cast', ['molten', 'water'], ['ingot', 'steam']),
    r('turbine', ['steam'], ['water']),
    r('plate', ['ingot'], ['plate']),
  ];
  const order = productionOrder(recipes).map((x) => x.id);
  const at = (id: string) => order.indexOf(id);
  expect(at('water')).toBe(0);
  expect(at('miner')).toBeLessThan(at('wash'));
  expect(at('wash')).toBeLessThan(at('filter'));
  expect(at('filter')).toBeLessThan(at('molten'));
  expect(at('molten')).toBeLessThan(at('cast'));
  expect(at('cast')).toBeLessThan(at('plate'));
  expect(at('cast')).toBeLessThan(at('turbine'));
});

test('the order does not depend on the input order', () => {
  const recipes = [r('x', ['a'], ['b']), r('y', [], ['a']), r('z', ['b'], ['c'])];
  const reversed = [...recipes].reverse();
  expect(productionOrder(reversed).map((x) => x.id)).toEqual(
    productionOrder(recipes).map((x) => x.id),
  );
});
