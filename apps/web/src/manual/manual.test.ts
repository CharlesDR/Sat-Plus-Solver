import type { Model } from '@sps/data';
import { missingNodeId } from '@sps/graph';
import { createHighsBackend, solve } from '@sps/solver';
import { createWorld, DEFAULT_FACTORY_ID, enterManual, resolveWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import miniJson from '../../../../fixtures/vanilla-mini/model.json';
import { focusPlan, modelCatalog, modelLabels } from '../solver/service';
import { PALETTE_LIMIT, paletteMatches, planToFreeze } from './manual';

const mini = miniJson as unknown as Model;
const backend = createHighsBackend();
const catalog = modelCatalog(mini);

describe('manual mode view (A36)', () => {
  test('the plan to freeze is each recipe group at its running throughput', () => {
    const graph = {
      nodes: [
        {
          id: 'recipe:b',
          kind: 'recipe' as const,
          label: 'B',
          recipe: 'b',
          machines: 2,
          inputs: [],
          outputs: [],
        },
        // A heater: 3 built, boiler at 50%.
        {
          id: 'recipe:a',
          kind: 'recipe' as const,
          label: 'A',
          recipe: 'a',
          machines: 3,
          boilerLoad: 0.5,
          inputs: [],
          outputs: [],
        },
        {
          id: 'target:x',
          kind: 'target' as const,
          label: 'X',
          item: 'x',
          rate: 1,
          inputs: [],
          outputs: [],
        },
      ],
      edges: [],
    };
    expect(planToFreeze(graph)).toEqual([
      { recipe: 'a', machines: 1.5 },
      { recipe: 'b', machines: 2 },
    ]);
    expect(planToFreeze(undefined)).toEqual([]);
  });

  test('the palette matches every word, products named exactly first', () => {
    expect(paletteMatches(catalog.recipes, '  ')).toEqual([]);
    const screws = paletteMatches(catalog.recipes, 'screw');
    expect(screws.map((r) => r.id)).toEqual(['cast-screw', 'screw']);
    const plate = paletteMatches(catalog.recipes, 'iron plate');
    expect(plate[0]!.id).toBe('iron-plate');
    expect(plate.map((r) => r.id)).toContain('reinforced-iron-plate');
    expect(paletteMatches(catalog.recipes, 'constructor').length).toBeLessThanOrEqual(
      PALETTE_LIMIT,
    );
  });

  test('missing inputs are listed apart from imports, like the flowchart draws them', async () => {
    const w = createWorld('vanilla-mini');
    w.factories[0]!.request.targets.push({ item: 'iron-plate', rate: 20 });
    const manual = enterManual(w, DEFAULT_FACTORY_ID, [{ recipe: 'iron-plate', machines: 1 }]);
    const r = await resolveWorld(manual, mini, (q) => solve(mini, q, backend));
    const p = focusPlan(mini, modelLabels(mini), r.factories[0]!);
    expect(p.manual).toEqual({ missing: [{ item: 'iron-ingot', name: 'Iron Ingot', rate: 30 }] });
    expect(p.plan.imports).toEqual([]);
    expect(p.graph.nodes.map((n) => n.id)).toContain(missingNodeId('iron-ingot'));
    expect(p.graph.nodes.some((n) => n.kind === 'import')).toBe(false);
  });
});
