import { describe, expect, test } from 'vitest';
import { causesText, flagView, markedText, offBuildText } from './build';

const names = { item: (id: string) => id.toUpperCase(), recipe: (id: string) => `R:${id}` };

describe('build marks in the app (A44)', () => {
  test('each flag reads as its name and one line per item or recipe', () => {
    expect(
      flagView(
        { kind: 'needs-expansion', severity: 'error', items: [{ item: 'plate', rate: 20 }] },
        names,
      ),
    ).toEqual({
      kind: 'needs-expansion',
      severity: 'error',
      title: 'Needs expansion',
      lines: ['PLATE: 20.0/min short of what is asked'],
    });
    expect(
      flagView(
        {
          kind: 'plan-changed',
          severity: 'warning',
          changes: [{ recipe: 'screw', built: 1.5, now: 1 / 3 }],
        },
        names,
      ).lines,
    ).toEqual(['R:screw: built 1.5, now 0.3334 (1/3)']);
    expect(
      flagView(
        {
          kind: 'over-resource-limit',
          severity: 'error',
          items: [{ item: 'ore', rate: 90, limit: 60 }],
        },
        names,
      ).lines,
    ).toEqual(['ORE: extracts 90.0/min, limit 60.0/min']);
    expect(flagView({ kind: 'data-changed', severity: 'info' }, names).title).toBe(
      'Game data changed',
    );
  });

  test('causes read as one sentence', () => {
    expect(causesText([])).toBeUndefined();
    expect(causesText(['links'])).toBe('Changed since the mark: its links.');
    expect(causesText(['factory-settings', 'links', 'game-data'])).toBe(
      'Changed since the mark: this factory’s settings, its links and the game data.',
    );
  });

  test('the world counts factories off their build', () => {
    const at = (state: 'matches' | 'note' | 'differs' | 'broken') => ({
      build: { state, flags: [], causes: [], markedAt: '' },
    });
    expect(offBuildText([{}, at('matches'), at('note')])).toBeUndefined();
    expect(offBuildText([at('broken')])).toBe('1 factory off their build');
    expect(offBuildText([at('differs'), at('broken'), {}])).toBe('2 factories off their build');
  });

  test('a bad time shows as given', () => {
    expect(markedText('soon')).toBe('soon');
    expect(markedText('2026-10-07T12:00:00.000Z')).toMatch(/2026/);
  });
});
