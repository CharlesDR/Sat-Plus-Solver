import { describe, expect, test } from 'vitest';
import { readInputs, runPipeline } from './build-data';

describe('pnpm build:data pipeline', () => {
  test('real data builds cleanly, including the free-lunch check', async () => {
    const { result, report } = await runPipeline(readInputs());
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.model).toBeDefined();
    expect(report).toContain('**Status: OK**');
    expect(report).toMatch(/## Free-lunch check\n\nPassed/);
    expect(report).toContain('## Overrides applied');
  });

  test('a free-lunch loop fails the build', async () => {
    const inputs = readInputs();
    const data = JSON.parse(inputs.gameData) as {
      Recipes: { Name: string; Parts: { Part: string; Amount: string }[] }[];
    };
    // Make Iron Rod → Iron Ingot exist and out-produce Iron Ingot → Iron Rod.
    data.Recipes.push({
      Name: 'Test Free Lunch',
      Machine: 'Constructor',
      BatchTime: '6',
      Tier: '0-0',
      Parts: [
        { Part: 'Iron Rod', Amount: '-1' },
        { Part: 'Iron Ingot', Amount: '100' },
      ],
    } as never);
    const { result, report } = await runPipeline({ ...inputs, gameData: JSON.stringify(data) });
    expect(result.model).toBeUndefined();
    expect(result.issues.map((i) => i.code)).toContain('freeLunch');
    expect(report).toContain('**Status: FAILED**');
  });
});
