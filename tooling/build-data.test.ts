import { describe, expect, test } from 'vitest';
import { modVersions, PINNED_VERSION, readInputs, runPipeline } from './build-data';

describe('pnpm build:data pipeline', () => {
  test('every mod version ships, the pinned one first (A111)', () => {
    expect(modVersions()).toEqual([PINNED_VERSION, '2026.4.651']);
  });

  test.each(modVersions())('%s builds cleanly, including the free-lunch check', async (version) => {
    const { result, report } = await runPipeline(readInputs(version));
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
