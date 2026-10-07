/**
 * The flowchart writes numbers with its own copy of the number format (the
 * graph package may not import the solver's code); both must agree (A41).
 */
import { rateText } from '@sps/graph';
import { formatRate } from '@sps/solver';
import fc from 'fast-check';
import { expect, test } from 'vitest';

test('the graph rateText and the solver formatRate write every number the same way', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.double({ min: -1e7, max: 1e7, noNaN: true }),
        fc
          .tuple(fc.integer({ min: -1e5, max: 1e5 }), fc.integer({ min: 1, max: 1000 }))
          .map(([p, q]) => p / q),
      ),
      (x) => {
        expect(rateText(x)).toBe(formatRate(x));
      },
    ),
    { seed: 41, numRuns: 2000 },
  );
});
