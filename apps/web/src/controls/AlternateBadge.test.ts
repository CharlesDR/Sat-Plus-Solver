import { describe, expect, test } from 'vitest';
import { unlockLabel } from './AlternateBadge';

describe('unlockLabel (A82)', () => {
  test('names the tier and the way it is unlocked', () => {
    expect(unlockLabel({ via: 'mam', tier: 6, schematic: 'Alternate Recipes: Motors' })).toEqual({
      text: 'T6 MAM',
      title: 'Researchable from tier 6: MAM research “Alternate Recipes: Motors”',
    });
    expect(
      unlockLabel({ via: 'hard-drive', tier: 7, schematic: 'Alternate: Alclad Busbar' }).text,
    ).toBe('T7 hard drive');
  });
});
