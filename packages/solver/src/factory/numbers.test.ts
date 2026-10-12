import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  exactFraction,
  exactText,
  formatExact,
  formatQuiet,
  formatRate,
  MAX_DENOMINATOR,
  mixedText,
} from './numbers';

describe('formatRate (A41)', () => {
  test('1 to 4 decimals, rounded up to the next 0.0001', () => {
    expect(formatRate(60)).toBe('60.0');
    expect(formatRate(2.5)).toBe('2.5');
    expect(formatRate(1 / 3)).toBe('0.3334');
    expect(formatRate(7 / 3)).toBe('2.3334');
    expect(formatRate(13.33333)).toBe('13.3334');
    expect(formatRate(0.12341)).toBe('0.1235');
    expect(formatRate(0.000626123)).toBe('0.0007');
    expect(formatRate(0.00001)).toBe('0.0001');
  });

  test('solver noise is not rounded up', () => {
    expect(formatRate(60.00000001)).toBe('60.0');
    expect(formatRate(1.99999999999)).toBe('2.0');
    expect(formatRate(0.25 + 1e-12)).toBe('0.25');
    expect(formatRate(1e-12)).toBe('0.0');
  });

  test('negatives round away from zero; no negative zero', () => {
    expect(formatRate(-1 / 3)).toBe('-0.3334');
    expect(formatRate(-0)).toBe('0.0');
    expect(formatRate(-1e-12)).toBe('0.0');
    expect(formatRate(Infinity)).toBe('Infinity');
  });

  test('commas between thousands', () => {
    expect(formatRate(999.99999)).toBe('1,000.0');
    expect(formatRate(1555.5556)).toBe('1,555.5556');
    expect(formatRate(-1234567.25)).toBe('-1,234,567.25');
  });

  test('never shows less than the value', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), (x) => {
        const shown = Number(formatRate(x).replace(/,/g, ''));
        expect(shown).toBeGreaterThanOrEqual(x - 1e-9 * Math.max(1, x));
        expect(shown - x).toBeLessThan(1e-4 + 1e-9);
      }),
      { seed: 41 },
    );
  });
});

describe('exact fractions (A41)', () => {
  test('mixed numbers in lowest terms', () => {
    expect(exactFraction(7 / 3)).toEqual({
      negative: false,
      whole: 2,
      numerator: 1,
      denominator: 3,
    });
    expect(mixedText(exactFraction(7 / 3)!)).toBe('2 1/3');
    expect(mixedText(exactFraction(1 / 3)!)).toBe('1/3');
    expect(mixedText(exactFraction(-1.5)!)).toBe('-1 1/2');
    expect(mixedText(exactFraction(4)!)).toBe('4');
    expect(mixedText(exactFraction(1234 + 2 / 7)!)).toBe('1,234 2/7');
  });

  test('solver noise still finds the fraction', () => {
    expect(mixedText(exactFraction(2 / 3 + 1e-12)!)).toBe('2/3');
  });

  test('no fraction for values without a small denominator', () => {
    expect(exactFraction(Math.PI)).toBeUndefined();
    expect(exactFraction(1 / (MAX_DENOMINATOR + 1))).toBeUndefined();
    expect(exactFraction(NaN)).toBeUndefined();
  });

  test('every fraction up to the largest denominator comes back exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: MAX_DENOMINATOR }),
        (p, q) => {
          const m = exactFraction(p / q)!;
          expect((m.whole * m.denominator + m.numerator) * q).toBe(p * m.denominator);
        },
      ),
      { seed: 41 },
    );
  });

  test('shown only when the decimals cannot show the value exactly', () => {
    expect(exactText(7 / 3)).toBe('2 1/3');
    expect(exactText(2.5)).toBeUndefined();
    expect(exactText(0.0625)).toBeUndefined();
    expect(exactText(60)).toBeUndefined();
    expect(formatExact(7 / 3)).toBe('2.3334 (2 1/3)');
    expect(formatExact(2.5)).toBe('2.5');
    expect(formatExact(Math.PI)).toBe('3.1416');
  });
});

describe('formatQuiet (UX-6, A78)', () => {
  test.each([
    [0, '0.0'],
    [1e-12, '0.0'],
    [0.00004, '<0.01'],
    [0.004, '<0.01'],
    [-0.004, '-<0.01'],
    [0.01, '0.01'],
    [0.0099999999999, '0.01'],
    [2 / 3, '0.67'],
    [7 / 3, '2.34'],
    [60, '60.0'],
    [60.00000001, '60.0'],
    [2.5, '2.5'],
    [1555.5556, '1,555.56'],
    [-12.341, '-12.35'],
  ])('%d → %s', (n, text) => {
    expect(formatQuiet(n)).toBe(text);
  });

  test('never shows less than formatRate, and is within 0.01 of it', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 1e7, noNaN: true }), (x) => {
        const quiet = Number(formatQuiet(x).replace(/,/g, ''));
        const precise = Number(formatRate(x).replace(/,/g, ''));
        expect(quiet).toBeGreaterThanOrEqual(precise - 1e-9);
        expect(quiet - precise).toBeLessThan(0.01 + 1e-9);
      }),
      { seed: 78, numRuns: 1000 },
    );
  });
});
