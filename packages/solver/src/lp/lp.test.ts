import { describe, expect, test } from 'vitest';
import { createHighsBackend } from './highs';
import { toLpText } from './lpFormat';
import type { LpModel } from './types';

const backend = createHighsBackend();

describe('toLpText', () => {
  test('uses safe generated names, merges terms and splits ranged rows', () => {
    const { text, columns, rows } = toLpText({
      sense: 'max',
      objective: [
        { var: 'recipe:a b', coef: 2 },
        { var: 'recipe:a b', coef: 1 },
        { var: 'y', coef: 0 },
      ],
      variables: [
        { name: 'recipe:a b', hi: 4 },
        { name: 'y', lo: -Infinity, integer: true },
      ],
      constraints: [
        {
          name: 'iron plate',
          terms: [
            { var: 'recipe:a b', coef: 1 },
            { var: 'y', coef: -0.5 },
          ],
          lo: 1,
          hi: 3,
        },
        { name: 'eq', terms: [{ var: 'y', coef: 1 }], lo: 2, hi: 2 },
      ],
    });
    expect(text).toContain('obj: + 3 x0');
    expect(text).toContain('c0: + 1 x0 - 0.5 x1 >= 1');
    expect(text).toContain('c1: + 1 x0 - 0.5 x1 <= 3');
    expect(text).toContain('c2: + 1 x1 = 2');
    expect(text).toContain('0 <= x0 <= 4');
    expect(text).toContain(' x1 free');
    expect(text).toMatch(/Generals\n x1/);
    expect(columns.get('x0')).toBe('recipe:a b');
    expect(rows.get('c0')).toBe('iron plate');
    expect(rows.get('c1')).toBe('iron plate');
  });

  test('rejects unknown variables and non-finite coefficients', () => {
    const base: LpModel = {
      sense: 'min',
      objective: [],
      variables: [{ name: 'x' }],
      constraints: [],
    };
    expect(() => toLpText({ ...base, objective: [{ var: 'nope', coef: 1 }] })).toThrow(
      /Unknown LP variable/,
    );
    expect(() => toLpText({ ...base, objective: [{ var: 'x', coef: NaN }] })).toThrow(/Non-finite/);
  });
});

describe('HiGHS backend', () => {
  test('solves an LP and returns values by model name', async () => {
    // max 3a + 2b  s.t. a + b <= 4, a + 3b <= 6, a <= 3
    const sol = await backend.solve({
      sense: 'max',
      objective: [
        { var: 'a', coef: 3 },
        { var: 'b', coef: 2 },
      ],
      variables: [{ name: 'a', hi: 3 }, { name: 'b' }],
      constraints: [
        {
          name: 'cap',
          terms: [
            { var: 'a', coef: 1 },
            { var: 'b', coef: 1 },
          ],
          hi: 4,
        },
        {
          name: 'mix',
          terms: [
            { var: 'a', coef: 1 },
            { var: 'b', coef: 3 },
          ],
          hi: 6,
        },
      ],
    });
    expect(sol.status).toBe('optimal');
    expect(sol.objective).toBeCloseTo(11, 9);
    expect(sol.values!.get('a')).toBeCloseTo(3, 9);
    expect(sol.values!.get('b')).toBeCloseTo(1, 9);
    expect(sol.duals!.has('cap')).toBe(true);
  });

  test('solves a MILP', async () => {
    const sol = await backend.solve({
      sense: 'max',
      objective: [{ var: 'n', coef: 1 }],
      variables: [{ name: 'n', integer: true }],
      constraints: [{ name: 'cap', terms: [{ var: 'n', coef: 2 }], hi: 7 }],
    });
    expect(sol.status).toBe('optimal');
    expect(sol.values!.get('n')).toBe(3);
  });

  test('reports infeasible and unbounded models', async () => {
    const infeasible = await backend.solve({
      sense: 'min',
      objective: [{ var: 'x', coef: 1 }],
      variables: [{ name: 'x', hi: 1 }],
      constraints: [{ name: 'need', terms: [{ var: 'x', coef: 1 }], lo: 2 }],
    });
    expect(['infeasible', 'infeasible-or-unbounded']).toContain(infeasible.status);
    expect(infeasible.values).toBeUndefined();

    const unbounded = await backend.solve({
      sense: 'max',
      objective: [{ var: 'x', coef: 1 }],
      variables: [{ name: 'x' }],
      constraints: [{ name: 'floor', terms: [{ var: 'x', coef: 1 }], lo: 1 }],
    });
    expect(['unbounded', 'infeasible-or-unbounded']).toContain(unbounded.status);
  });

  test('handles a model with nothing to optimize', async () => {
    const sol = await backend.solve({
      sense: 'min',
      objective: [],
      variables: [],
      constraints: [],
    });
    expect(sol.status).toBe('optimal');
  });
});
