/**
 * Layout score guard (A43): every flowchart change is measured on fixed plans.
 * A change may not add crossings, bends, edge length or area on any of them,
 * and may not bring two boxes closer than the floor. A change that improves
 * the scores lowers the baseline (`pnpm layout-score --update`) in the same
 * PR; raising a baseline number or lowering the floor needs Charles's OK.
 */
import type { Model } from '@sps/data';
import type { LayoutScore } from '@sps/graph';
import { beforeAll, describe, expect, test } from 'vitest';
import { runPipeline } from './build-data';
import { loadBaseline, SCORE_PLANS, scorePlans } from './layout-score';

/** Room for float noise in summed lengths and areas. */
const SLACK = 1e-6;

describe('flowchart layout score (A43)', () => {
  let scores: Record<string, LayoutScore & { nodes: number }>;
  const baseline = loadBaseline();

  beforeAll(async () => {
    const { result } = await runPipeline();
    scores = await scorePlans(result.model as Model);
  }, 180_000);

  test('the baseline covers every scored plan', () => {
    expect(Object.keys(baseline.plans).sort()).toEqual(Object.keys(SCORE_PLANS).sort());
  });

  for (const name of Object.keys(SCORE_PLANS))
    test(`${name}: no worse than the baseline`, () => {
      const s = scores[name]!;
      const b = baseline.plans[name]!;
      // The same plan, so the scores compare like with like.
      expect(s.nodes).toBe(b.nodes);
      expect(s.crossings).toBeLessThanOrEqual(b.crossings);
      expect(s.bends).toBeLessThanOrEqual(b.bends);
      expect(s.edgeLength).toBeLessThanOrEqual(b.edgeLength * (1 + SLACK));
      expect(s.area).toBeLessThanOrEqual(b.area * (1 + SLACK));
      expect(s.minGap).toBeGreaterThanOrEqual(baseline.minGapFloor);
    });
});
