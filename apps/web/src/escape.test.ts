import { describe, expect, test } from 'vitest';
import { escapeStack } from './escape';
import { backOut, factoryView, focusOf, parentLookup, WORLD_VIEW } from './viewPath';

describe('Esc stack (A42)', () => {
  test('closes the most recently opened layer first, one per press', () => {
    const closed: string[] = [];
    const stack = escapeStack();
    stack.push(() => closed.push('selection'));
    stack.push(() => closed.push('tooltip'));
    expect(stack.pop()).toBe(true);
    expect(stack.pop()).toBe(true);
    expect(stack.pop()).toBe(false);
    expect(closed).toEqual(['tooltip', 'selection']);
  });

  test('a layer opened above closes before plain layers opened after it (A48)', () => {
    const closed: string[] = [];
    const stack = escapeStack();
    stack.push(() => closed.push('tooltip'), true);
    stack.push(() => closed.push('selection'));
    stack.pop();
    stack.pop();
    expect(closed).toEqual(['tooltip', 'selection']);
  });

  test('a layer removed before Esc is not closed', () => {
    const closed: string[] = [];
    const stack = escapeStack();
    stack.push(() => closed.push('a'));
    const remove = stack.push(() => closed.push('b'));
    remove();
    remove();
    stack.pop();
    expect(closed).toEqual(['a']);
  });
});

describe('view path (A42)', () => {
  test('backing out goes up one level at a time, and stops at the world', () => {
    const nested = { path: ['outer', 'inner'] };
    expect(backOut(nested)).toEqual({ path: ['outer'] });
    expect(backOut(backOut(nested))).toEqual(WORLD_VIEW);
    expect(backOut(WORLD_VIEW)).toBe(WORLD_VIEW);
    expect(backOut(factoryView('f'))).toEqual(WORLD_VIEW);
  });

  test('the focus is the innermost factory, or none once it is gone', () => {
    expect(focusOf({ path: ['outer', 'inner'] }, () => true)).toBe('inner');
    expect(focusOf(factoryView('gone'), () => false)).toBeUndefined();
    expect(focusOf(WORLD_VIEW, () => true)).toBeUndefined();
  });

  test('Esc from a grandchild returns to the child, then the parent, then the world (A49)', () => {
    const parentOf = parentLookup({
      factories: [{ id: 'p' }, { id: 'c', parentId: 'p' }, { id: 'gc', parentId: 'c' }],
    });
    let view = factoryView('gc', parentOf);
    expect(view.path).toEqual(['p', 'c', 'gc']);
    const seen = [];
    while (view.path.length) seen.push((view = backOut(view)).path.at(-1) ?? 'world');
    expect(seen).toEqual(['c', 'p', 'world']);
    // A parent cycle or an unknown parent stops the chain.
    const loop = parentLookup({
      factories: [
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ],
    });
    expect(factoryView('a', loop).path).toEqual(['b', 'a']);
    expect(parentLookup({ factories: [{ id: 'x', parentId: 'nope' }] })('x')).toBeUndefined();
  });
});
