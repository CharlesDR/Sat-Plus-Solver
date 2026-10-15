import { expect, test } from 'vitest';
import type { FactoryGraph, FlowNode } from './factory';
import { importSuggestions } from './suggest';

const box = (id: string, outputs: string[], kind: FlowNode['kind'] = 'recipe'): FlowNode => ({
  id: `recipe:${id}`,
  kind,
  label: id,
  recipe: id,
  inputs: [],
  outputs: outputs.map((item) => ({ item, rate: 1 })),
});
const end = (kind: 'target' | 'import', item: string): FlowNode => ({
  id: `${kind}:${item}`,
  kind,
  label: item,
  item,
  inputs: [],
  outputs: [],
});
const line = (source: string, target: string, item: string) => ({
  id: `${source}→${target}:${item}`,
  source,
  target,
  item,
  itemName: item[0]!.toUpperCase() + item.slice(1),
  rate: 1,
});

/**
 * Oil and water into a refinery and a plastic press; ore into a smelter and
 * a plate press; an imported screw; the computer takes plastic and plates.
 */
function plan(): FactoryGraph {
  const r = (id: string) => `recipe:${id}`;
  return {
    nodes: [
      end('import', 'screw'),
      box('oil', ['crude'], 'resource'),
      box('water', ['water'], 'resource'),
      box('ore', ['ore'], 'resource'),
      box('refinery', ['resin']),
      box('plastic', ['plastic']),
      box('smelt', ['ingot']),
      box('plate', ['plate']),
      box('computer', ['computer']),
      end('target', 'computer'),
    ],
    edges: [
      line(r('oil'), r('refinery'), 'crude'),
      line(r('water'), r('plastic'), 'water'),
      line(r('refinery'), r('plastic'), 'resin'),
      line(r('plastic'), r('computer'), 'plastic'),
      line(r('ore'), r('smelt'), 'ore'),
      line(r('smelt'), r('plate'), 'ingot'),
      line('import:screw', r('plate'), 'screw'),
      line(r('plate'), r('computer'), 'plate'),
      line(r('computer'), 'target:computer', 'computer'),
    ],
  };
}

test('suggests the parts whose own upstream is big, fluids weighing most (A91)', () => {
  const s = importSuggestions(plan(), new Set(['crude', 'water']));
  // Plastic takes oil, water, the refinery and the press; resin's upstream is
  // inside plastic's, so it is left out.
  expect(s[0]).toEqual({
    item: 'plastic',
    name: 'Plastic',
    boxes: 4,
    resources: ['crude', 'water'],
    imports: [],
    score: 4 + 4 + 4,
  });
  // Plate takes 3 of 8 boxes, over the 20% share, and the screw import.
  expect(s[1]).toMatchObject({ item: 'plate', boxes: 3, resources: ['ore'], imports: ['screw'] });
  expect(s.map((x) => x.item)).not.toContain('resin');
  // Without fluids, ore and crude weigh the same.
  expect(importSuggestions(plan())[0]!.score).toBe(4 + 2 + 2);
});

test('never suggests a target, a raw resource or an import', () => {
  const items = importSuggestions(plan()).map((x) => x.item);
  for (const no of ['computer', 'crude', 'ore', 'screw']) expect(items).not.toContain(no);
});
