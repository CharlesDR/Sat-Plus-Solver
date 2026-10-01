import { expect, test } from 'vitest';
import { formatRate } from './summary';

test('formatRate: 3 decimals, 3 significant digits below 0.001, no negative zero', () => {
  expect(formatRate(60)).toBe('60');
  expect(formatRate(13.33333)).toBe('13.333');
  expect(formatRate(0.000626123)).toBe('0.000626');
  expect(formatRate(0)).toBe('0');
  expect(formatRate(-0.0000001)).toBe('-1.00e-7');
  expect(formatRate(-0.0004)).toBe('-0.000400');
  expect(formatRate(-0.0)).toBe('0');
  expect(formatRate(Infinity)).toBe('Infinity');
});
