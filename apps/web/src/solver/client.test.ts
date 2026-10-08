import { createWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import { createSolverClient, type WorkerLike } from './client';
import type { FromWorker, ToWorker, WorldSummary } from './protocol';

function fakeWorker() {
  const sent: ToWorker[] = [];
  let listener: ((e: MessageEvent<FromWorker>) => void) | undefined;
  let onError: ((e: { message?: string }) => void) | undefined;
  const worker: WorkerLike & { terminated: boolean } = {
    terminated: false,
    postMessage: (m) => sent.push(m),
    addEventListener: ((type: 'message' | 'error', fn: never) => {
      if (type === 'message') listener = fn;
      else onError = fn;
    }) as WorkerLike['addEventListener'],
    terminate() {
      this.terminated = true;
    },
  };
  const reply = (m: FromWorker) => listener!({ data: m } as MessageEvent<FromWorker>);
  const crash = (message?: string) => onError!(message === undefined ? {} : { message });
  return { worker, sent, reply, crash };
}

const summary = (machines: number) => ({ machines }) as WorldSummary;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('solver client', () => {
  test('ready carries the catalog and data hash', async () => {
    const { worker, reply } = fakeWorker();
    const client = createSolverClient(worker);
    const catalog = {
      targets: [{ id: 'a', name: 'A' }],
      items: [],
      recipes: [],
      nodes: [],
      resources: [],
      tiers: [],
      fluids: [],
      belts: [],
      pipes: [],
      areas: [],
      itemAreas: {},
    };
    reply({ type: 'ready', catalog, dataHash: 'h' });
    await expect(client.ready).resolves.toEqual({ catalog, dataHash: 'h' });
  });

  test('init errors reject ready', async () => {
    const { worker, reply } = fakeWorker();
    const client = createSolverClient(worker);
    reply({ type: 'init-error', message: 'boom' });
    await expect(client.ready).rejects.toThrow('boom');
  });

  test('one solve in flight; only the newest queued request is sent next', async () => {
    const { worker, sent, reply } = fakeWorker();
    const client = createSolverClient(worker);
    const w1 = createWorld('1');
    const w2 = createWorld('2');
    const w3 = createWorld('3');
    const p1 = client.solve({ world: w1, focus: 'f' });
    const p2 = client.solve({ world: w2, focus: 'f' });
    const p3 = client.solve({ world: w3, action: { kind: 'size-power', factoryId: 'f' } });
    expect(sent.map((m) => m.world)).toEqual([w1]);
    expect(sent[0]).toMatchObject({ type: 'solve', focus: 'f' });
    await expect(p2).resolves.toBeNull();

    reply({ type: 'solved', id: sent[0]!.id, world: summary(1), ms: 5 });
    await expect(p1).resolves.toEqual({ world: summary(1), ms: 5 });
    expect(sent.map((m) => m.world)).toEqual([w1, w3]);
    expect(sent[1]).toMatchObject({ action: { kind: 'size-power', factoryId: 'f' } });
    expect(sent[1]).not.toHaveProperty('focus');

    reply({ type: 'failed', id: sent[1]!.id, message: 'nope' });
    await expect(p3).rejects.toThrow('nope');
  });

  test('replies to unknown ids are ignored; dispose settles pending requests', async () => {
    const { worker, sent, reply } = fakeWorker();
    const client = createSolverClient(worker);
    let settled: unknown = 'pending';
    const p = client.solve({ world: createWorld() }).then((v) => (settled = v));
    reply({ type: 'solved', id: sent[0]!.id + 99, world: summary(1), ms: 1 });
    await flush();
    expect(settled).toBe('pending');
    client.dispose();
    await p;
    expect(settled).toBeNull();
    expect(worker.terminated).toBe(true);
  });

  test('progress reaches the request in flight only', async () => {
    const { worker, sent, reply } = fakeWorker();
    const client = createSolverClient(worker);
    const heard: string[] = [];
    const p = client.solve({ world: createWorld() }, (x) => heard.push(x.factory));
    const progress = { factory: 'Smelter', step: 1, factories: 2, pass: 1 };
    reply({ type: 'progress', id: sent[0]!.id, progress });
    reply({ type: 'progress', id: sent[0]!.id + 1, progress: { ...progress, factory: 'Other' } });
    reply({ type: 'solved', id: sent[0]!.id, world: summary(1), ms: 1 });
    await p;
    expect(heard).toEqual(['Smelter']);
  });

  test('a crashed worker fails ready, the solve in flight, the queued one and later ones', async () => {
    const { worker, crash } = fakeWorker();
    const client = createSolverClient(worker);
    const p1 = client.solve({ world: createWorld('1') });
    const p2 = client.solve({ world: createWorld('2') });
    crash('out of memory');
    await expect(client.ready).rejects.toThrow('The solver stopped unexpectedly: out of memory');
    await expect(p1).rejects.toThrow('out of memory');
    await expect(p2).rejects.toThrow('out of memory');
    await expect(client.solve({ world: createWorld('3') })).rejects.toThrow('stopped');
  });
});
