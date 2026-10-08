import { describe, expect, test } from 'vitest';
import { createHighsBackend } from '../lp/highs';
import { sizeNetwork, type Network } from './size';

const backend = createHighsBackend();
const ore = { item: 'ore', rate: 30 };
const ingot = { item: 'ingot', rate: 30 };
const plate = { item: 'plate', rate: 20 };

describe('sizeNetwork (A56)', () => {
  test('a cap at the end sizes everything upstream to what it needs', async () => {
    const net: Network = {
      nodes: [
        { id: 'ore', kind: 'source' },
        { id: 'smelt', kind: 'machine', inputs: [ore], outputs: [ingot] },
        {
          id: 'press',
          kind: 'machine',
          max: 3,
          inputs: [{ item: 'ingot', rate: 30 }],
          outputs: [plate],
        },
      ],
      edges: [
        { from: 'ore', to: 'smelt', item: 'ore' },
        { from: 'smelt', to: 'press', item: 'ingot' },
      ],
    };
    const r = await sizeNetwork(net, backend);
    expect(r.status).toBe('ok');
    expect(r.machines.get('press')).toBeCloseTo(3, 9);
    expect(r.machines.get('smelt')).toBeCloseTo(3, 9);
    expect(r.flows[0]).toBeCloseTo(90, 9);
  });

  test('a capped source pushes its output on to a sink, through a splitter', async () => {
    const net: Network = {
      nodes: [
        { id: 'mine', kind: 'machine', max: 2, inputs: [], outputs: [ore] },
        { id: 'split', kind: 'pass' },
        { id: 'smelt', kind: 'machine', inputs: [ore], outputs: [ingot] },
        { id: 'box', kind: 'sink' },
      ],
      edges: [
        { from: 'mine', to: 'split', item: 'ore' },
        { from: 'split', to: 'smelt', item: 'ore' },
        { from: 'smelt', to: 'box', item: 'ingot' },
      ],
    };
    const r = await sizeNetwork(net, backend);
    expect(r.machines.get('mine')).toBeCloseTo(2, 9);
    expect(r.machines.get('smelt')).toBeCloseTo(2, 9);
  });

  test('an uncapped chain with nothing driving it runs at none', async () => {
    const net: Network = {
      nodes: [
        { id: 'ore', kind: 'source' },
        { id: 'smelt', kind: 'machine', inputs: [ore], outputs: [ingot] },
        { id: 'box', kind: 'sink' },
      ],
      edges: [
        { from: 'ore', to: 'smelt', item: 'ore' },
        { from: 'smelt', to: 'box', item: 'ingot' },
      ],
    };
    const r = await sizeNetwork(net, backend);
    expect(r.status).toBe('ok');
    expect(r.machines.get('smelt')).toBe(0);
  });

  test('a cap the wiring cannot feed is met as far as it can be', async () => {
    // The press wants 90 ingots at its cap; a capped smelter makes 30.
    const net: Network = {
      nodes: [
        { id: 'ore', kind: 'source' },
        { id: 'smelt', kind: 'machine', max: 1, inputs: [ore], outputs: [ingot] },
        {
          id: 'press',
          kind: 'machine',
          max: 3,
          inputs: [{ item: 'ingot', rate: 30 }],
          outputs: [plate],
        },
      ],
      edges: [
        { from: 'ore', to: 'smelt', item: 'ore' },
        { from: 'smelt', to: 'press', item: 'ingot' },
      ],
    };
    const r = await sizeNetwork(net, backend);
    expect(r.machines.get('smelt')).toBeCloseTo(1, 9);
    expect(r.machines.get('press')).toBeCloseTo(1, 9);
  });
});
