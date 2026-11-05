import { createFactory, createWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import { switchNote } from './switchNote';

const world = () => {
  const w = createWorld();
  w.factories = [createFactory('a', 'Smelter'), createFactory('b', 'Frames')];
  return w;
};

describe('switchNote (A111)', () => {
  test('a clean switch only says where the world is now', () => {
    expect(switchNote('2026.4.651', { dropped: [], changed: [] }, world())).toBe(
      'Now on SF+ 2026.4.651; every factory re-solves.',
    );
  });

  test('names what was dropped and where, up to four, and the manual factories that changed', () => {
    const d = (name: string, factoryId?: string) => ({
      recipe: name.toLowerCase(),
      name,
      kind: 'toggle' as const,
      ...(factoryId ? { factoryId } : {}),
    });
    const note = switchNote(
      '2026.3.489',
      {
        dropped: [d('Alpha'), d('Beta', 'a'), d('Gamma', 'a'), d('Delta', 'b'), d('Eps', 'b')],
        changed: [{ factoryId: 'b', recipes: ['washed-iron'] }],
      },
      world(),
      'This world used SF+ 2026.2.1, which this app doesn’t have.',
    );
    expect(note).toBe(
      'This world used SF+ 2026.2.1, which this app doesn’t have. Now on SF+ 2026.3.489; every factory re-solves. ' +
        'Dropped 5 settings naming recipes it lacks: Alpha (world defaults), Beta (Smelter), Gamma (Smelter), ' +
        'Delta (Frames), and 1 more. Manual factory Frames kept its machine counts, but some of its recipes changed.',
    );
  });
});
