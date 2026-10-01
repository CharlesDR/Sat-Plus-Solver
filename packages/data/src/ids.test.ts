import { describe, expect, test } from 'vitest';
import { assignIds, slug } from './ids';

describe('slug', () => {
  test.each([
    ['Iron Plate', 'iron-plate'],
    ['A.I. Fluid Packer', 'a-i-fluid-packer'],
    ['Turbine Mk.1 - MV Generator (MP)', 'turbine-mk-1-mv-generator-mp'],
    ['  Café  ', 'cafe'],
  ])('%s → %s', (name, expected) => expect(slug(name)).toBe(expected));
});

describe('assignIds', () => {
  const a = { name: 'Same Name', v: 1 };
  const b = { name: 'Same Name', v: 2 };
  const c = { name: 'Unique', v: 3 };

  test('unique names keep the plain slug; collisions get a content-hash suffix', () => {
    const ids = assignIds([a, b, c], (e) => e.name);
    expect(ids.get(c)).toBe('unique');
    expect(ids.get(a)).toMatch(/^same-name~[0-9a-f]{6}$/);
    expect(ids.get(a)).not.toBe(ids.get(b));
  });

  test('ids do not depend on input order', () => {
    const forward = assignIds([a, b, c], (e) => e.name);
    const reverse = assignIds([c, b, a], (e) => e.name);
    for (const e of [a, b, c]) expect(reverse.get(e)).toBe(forward.get(e));
  });
});
