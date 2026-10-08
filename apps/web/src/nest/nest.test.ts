import { addFactory, createWorld, setFactoryParent } from '@sps/world';
import { describe, expect, test } from 'vitest';
import { parentOptions, totalsText } from './nest';

describe('nested factories in the app (A49)', () => {
  test('a factory moves inside any factory but itself and those below it', () => {
    let w = createWorld('h');
    const a = addFactory(w, 'Alpha');
    const b = addFactory(a.world, 'Beta');
    w = setFactoryParent(b.world, b.id, a.id);
    const ids = (id: string) => parentOptions(w, id).map((o) => o.id);
    expect(ids(a.id)).toEqual(['factory-main']);
    expect(ids(b.id)).toEqual([a.id, 'factory-main']);
  });

  test('totals read as power and machines', () => {
    const power = { consumptionMW: 12.5, generationMW: 0, netMW: 12.5 };
    expect(totalsText({ power, machines: 7 })).toBe('12.5 MW draw · 7 machines');
    expect(
      totalsText({ power: { consumptionMW: 4, generationMW: 75, netMW: -71 }, machines: 1 }),
    ).toBe('4.0 MW draw · 75.0 MW gen · 1 machine');
  });
});
