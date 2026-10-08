import type { Model } from '@sps/data';
import { createHighsBackend } from '@sps/solver';
import {
  addFactory,
  createWorld,
  enterManual,
  manualEntries,
  setManualCount,
  type World,
} from '@sps/world';
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, test } from 'vitest';
import miniJson from '../../../../fixtures/vanilla-mini/model.json';
import { createSolverService } from './service';

const mini = miniJson as unknown as Model;
const service = createSolverService(mini, createHighsBackend(), new ELK());
const AT = '2026-10-08T00:00:00.000Z';

/** A world whose main factory makes Reinforced Iron Plate, with a sub-factory making Wire. */
function world(): World {
  let w = createWorld('vanilla-mini');
  w.factories[0]!.request.targets.push({ item: 'reinforced-iron-plate', rate: 5 });
  const added = addFactory(w, 'Wire', undefined, w.factories[0]!.id);
  w = added.world;
  w.factories[1]!.request.targets.push({ item: 'wire', rate: 45 });
  return w;
}

async function roundTrip(w: World, factoryId?: string) {
  const exported = await service.solve({
    world: w,
    action: { kind: 'export-modeler', ...(factoryId ? { factoryId } : {}) },
  });
  expect(exported.sfmd).toBeDefined();
  const fresh = { ...createWorld('vanilla-mini'), factories: [] };
  const imported = await service.solve({
    world: fresh,
    action: { kind: 'import-modeler', text: exported.sfmd!, at: AT },
  });
  return { exported, imported, back: imported.edited! };
}

describe('Modeler export and import through the solver service (M14)', () => {
  test('a solved factory comes back with the same recipes and machine counts, exactly', async () => {
    const w = world();
    const solved = await service.solve({ world: w, focus: w.factories[0]!.id });
    const { back, imported } = await roundTrip(w, w.factories[0]!.id);
    expect(back.factories).toHaveLength(1);
    const f = back.factories[0]!;
    // The export's plan is the world's: its targets, plus what the sub-factory takes.
    const plan = solved.world.factories.find((x) => x.id === w.factories[0]!.id)!.plan;
    expect(manualEntries(f.manual!)).toEqual(plan);
    expect(f.manual!.enabled).toBe(true);
    expect(f.built?.entries).toEqual(plan);
    expect(f.built?.markedAt).toBe(AT);
    expect(imported.imported?.factories).toEqual([f.id]);
  });

  test('a manual factory and its sub-factory come back nested, as built', async () => {
    let w = world();
    const id = w.factories[0]!.id;
    const solved = await service.solve({ world: w });
    const of = (fid: string) => solved.world.factories.find((x) => x.id === fid)!;
    w = enterManual(w, id, of(id).plan);
    w = setManualCount(w, id, 'iron-plate', 7 / 3);
    const { back, imported } = await roundTrip(w);
    expect(back.factories.map((f) => [f.name, f.parentId ?? null])).toEqual([
      ['Factory', null],
      ['Wire', back.factories[0]!.id],
    ]);
    expect(manualEntries(back.factories[0]!.manual!)).toEqual(
      manualEntries(w.factories[0]!.manual!),
    );
    const child = of(w.factories[1]!.id);
    expect(manualEntries(back.factories[1]!.manual!)).toEqual(child.plan);
    expect(back.factories.every((f) => f.built)).toBe(true);
    expect(imported.world.factories.every((f) => f.status !== 'infeasible')).toBe(true);
  });

  test('a malformed file fails and leaves the world as it was', async () => {
    const w = world();
    await expect(
      service.solve({ world: w, action: { kind: 'import-modeler', text: '{"Data": 3}', at: AT } }),
    ).rejects.toThrow(/not a Satisfactory Modeler save/);
  });
});
