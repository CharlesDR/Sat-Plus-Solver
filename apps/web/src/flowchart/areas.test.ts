import { describe, expect, test } from 'vitest';
import { areaCatalog, areaChoices } from './areas';

const catalog = {
  areas: [
    { id: 'ore', name: 'Ore Processing', rule: 'raw' as const },
    { id: 'steel', name: 'Steelworks' },
  ],
  itemAreas: { 'iron-ore': 'ore', 'steel-beam': 'steel' },
};

describe('flowchart areas (A61)', () => {
  test('looks items up in the catalog', () => {
    const c = areaCatalog(catalog);
    expect(c.areas).toBe(catalog.areas);
    expect(c.itemArea('steel-beam')).toBe('steel');
    expect(c.itemArea('nope')).toBeUndefined();
  });

  test('lists every area by the factory’s names, a blank name keeping the default', () => {
    expect(areaChoices(catalog, { names: { steel: 'Steel Mill', ore: ' ' } })).toEqual([
      { id: 'ore', name: 'Ore Processing' },
      { id: 'steel', name: 'Steel Mill' },
    ]);
    expect(areaChoices(catalog, undefined).map((a) => a.name)).toEqual([
      'Ore Processing',
      'Steelworks',
    ]);
  });
});
