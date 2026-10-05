import { describe, expect, test } from 'vitest';
import {
  countLabel,
  factoryDiagnostics,
  progressLabel,
  roundUp,
  worldDiagnostics,
  withImport,
  withResourceLimit,
  type Names,
} from './diagnostics';

const names: Names = {
  item: (id) => ({ 'iron-plate': 'Iron Plate', 'iron-ore': 'Iron Ore', screw: 'Screw' })[id] ?? id,
  recipe: (id) => ({ 'cast-screw': 'Alternate: Cast Screw' })[id] ?? id,
  node: (id) => ({ 'node:iron-ore:pure': 'Iron Ore (pure)' })[id] ?? id,
  factory: (id) => ({ 'factory-1': 'Smelter' })[id] ?? id,
};

describe('diagnostics view (M10)', () => {
  test('roundUp keeps three significant digits and never rounds a shortfall down', () => {
    expect(roundUp(3.2)).toBe(3.2);
    expect(roundUp(3.2001)).toBe(3.21);
    expect(roundUp(1234.5)).toBe(1240);
    expect(roundUp(0.012345)).toBe(0.0124);
    expect(roundUp(0)).toBe(0);
    expect(roundUp(-1)).toBe(0);
    for (const x of [0.1, 0.7, 1 / 3, 40, 59.99, 123456.7])
      expect(roundUp(x)).toBeGreaterThanOrEqual(x);
  });

  test('an unreachable target offers to turn on each closest recipe, by name', () => {
    const [v] = factoryDiagnostics(
      [
        {
          code: 'unreachable',
          severity: 'error',
          item: 'screw',
          message: 'Nothing can produce Screw.',
          fixes: ['cast-screw', 'screw'],
        },
      ],
      names,
      {},
    );
    expect(v).toEqual({
      severity: 'error',
      title: 'Nothing can produce Screw',
      message: 'Nothing can produce Screw.',
      fixes: [
        { kind: 'enable-recipe', recipe: 'cast-screw', label: 'Turn on Alternate: Cast Screw' },
        { kind: 'enable-recipe', recipe: 'screw', label: 'Turn on screw' },
      ],
    });
  });

  test('an infeasible plan offers imports and resource fixes, not node-pool ones', () => {
    const d = {
      code: 'infeasible' as const,
      severity: 'error' as const,
      message: 'Infeasible: needs …',
      relaxations: [
        { kind: 'node' as const, node: 'node:iron-ore:pure', amount: 0.5001 },
        { kind: 'resource' as const, item: 'iron-ore', amount: 30.01 },
        { kind: 'import' as const, item: 'iron-plate', amount: 40 },
      ],
    };
    const on = { 'iron-ore': { enabled: true, max: 60 } };
    expect(factoryDiagnostics([d], names, on)[0]!.fixes).toEqual([
      {
        kind: 'raise-resource',
        item: 'iron-ore',
        amount: 30.1,
        label: 'Raise the Iron Ore limit by 30.1/min',
      },
      { kind: 'add-import', item: 'iron-plate', rate: 40, label: 'Import 40/min more Iron Plate' },
    ]);
    const off = { 'iron-ore': { enabled: false } };
    expect(factoryDiagnostics([d], names, off)[0]!.fixes[0]!.label).toBe('Turn on Iron Ore');
  });

  test('warnings name the gap and the relaxed tolerance', () => {
    const vs = factoryDiagnostics(
      [
        { code: 'time-limit', severity: 'warning', message: 'm', gap: 0.0123 },
        { code: 'tolerance-relaxed', severity: 'warning', message: 'm', tolerance: 0.001 },
        { code: 'numerical', severity: 'error', message: 'The LP solver failed: x.' },
      ],
      names,
      {},
    );
    expect(vs.map((v) => v.title)).toEqual([
      'The solver ran out of time (gap 1.23%)',
      'Tolerance was relaxed to 0.1%',
      'The solver failed',
    ]);
    expect(vs.every((v) => v.fixes.length === 0)).toBe(true);
    expect(countLabel(vs)).toBe('1 error, 2 warnings');
    expect(countLabel([])).toBe('');
  });

  test('world diagnostics link to the factory, link or panel that fixes them', () => {
    const vs = worldDiagnostics(
      [
        {
          code: 'factory-failed',
          severity: 'error',
          factory: 'factory-1',
          status: 'infeasible',
          message: 'Smelter is infeasible',
        },
        {
          code: 'link-short',
          severity: 'warning',
          link: 'link-1',
          item: 'iron-plate',
          deficit: 3,
          message: 'short',
        },
        {
          code: 'cycle-not-converged',
          severity: 'error',
          factories: ['a', 'b'],
          links: ['link-2', 'link-3'],
          iterations: 25,
          message: 'cycle',
        },
        {
          code: 'node-over-allocated',
          severity: 'error',
          node: 'node:iron-ore:pure',
          used: 5,
          pool: 4,
          message: 'over',
        },
        { code: 'invalid-link', severity: 'error', link: 'link-9', message: 'bad' },
      ],
      names,
    );
    expect(vs.map((v) => [v.title, v.fixes.map((f) => f.label)])).toEqual([
      ['Smelter has no plan', ['Open Smelter']],
      ['A link of Iron Plate is short', ['Edit link link-1']],
      ['A pull cycle did not settle', ['Edit link link-2', 'Edit link link-3']],
      ['Iron Ore (pure) is over-allocated', ['Show the node pool']],
      ['A link is ignored', ['Remove link link-9']],
    ]);
  });

  test('progress names the factory and clamps cycle sweeps to the factory count', () => {
    expect(progressLabel(undefined, 'the world')).toBe('Solving the world…');
    expect(progressLabel({ factory: 'Smelter', step: 2, factories: 5, pass: 1 }, 'x')).toBe(
      'Solving Smelter (2 of 5)…',
    );
    expect(progressLabel({ factory: 'A', step: 9, factories: 2, pass: 2 }, 'x')).toBe(
      'Solving A (2 of 2, pass 2)…',
    );
  });

  test('fixes edit imports and node caps without touching other entries', () => {
    const imports = [{ item: 'screw', cap: 10 }, { item: 'iron-ore' }];
    expect(withImport(imports, 'screw', 5)).toEqual([
      { item: 'screw', cap: 15 },
      { item: 'iron-ore' },
    ]);
    expect(withImport(imports, 'iron-plate', 0.1)).toEqual([
      ...imports,
      { item: 'iron-plate', cap: 0.1 },
    ]);
    expect(withImport([{ item: 'screw', cap: 0.1 }], 'screw', 0.2)).toEqual([
      { item: 'screw', cap: 0.3 },
    ]);
    const water = { water: { enabled: false } };
    expect(withResourceLimit({ a: { enabled: true, max: 1 }, ...water }, 'a', 0.5)).toEqual({
      a: { enabled: true, max: 1.5 },
      ...water,
    });
    expect(withResourceLimit(water, 'water', 90)).toEqual({ water: { enabled: true } });
    // Turning on keeps a limit, raised to at least what the plan needs.
    expect(withResourceLimit({ a: { enabled: false, max: 10 } }, 'a', 30)).toEqual({
      a: { enabled: true, max: 30 },
    });
    expect(withResourceLimit({ a: { enabled: false, max: 50 } }, 'a', 30)).toEqual({
      a: { enabled: true, max: 50 },
    });
  });
});
