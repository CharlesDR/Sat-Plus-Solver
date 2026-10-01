import type { PlanSummary } from '@sps/solver';
import { createWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import { createSolverClient, type WorkerLike } from './client';
import type { FromWorker, ToWorker } from './protocol';

function fakeWorker() {
  const sent: ToWorker[] = [];
  let listener: ((e: MessageEvent<FromWorker>) => void) | undefined;
  const worker: WorkerLike & { terminated: boolean } = {
    terminated: false,
    postMessage: (m) => sent.push(m),
    addEventListener: (_type, fn) => (listener = fn),
    terminate() {
      this.terminated = true;
    },
  };
  const reply = (m: FromWorker) => listener!({ data: m } as MessageEvent<FromWorker>);
  return { worker, sent, reply };
}

const plan = (objectiveValue: number) => ({ objectiveValue }) as PlanSummary;
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
      tiers: [],
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
    const p1 = client.solve(w1, 'f');
    const p2 = client.solve(w2, 'f');
    const p3 = client.solve(w3, 'f');
    expect(sent.map((m) => m.world)).toEqual([w1]);
    await expect(p2).resolves.toBeNull();

    reply({ type: 'solved', id: sent[0]!.id, plan: plan(1), ms: 5 });
    await expect(p1).resolves.toEqual({ plan: plan(1), ms: 5 });
    expect(sent.map((m) => m.world)).toEqual([w1, w3]);

    reply({ type: 'failed', id: sent[1]!.id, message: 'nope' });
    await expect(p3).rejects.toThrow('nope');
  });

  test('replies to unknown ids are ignored; dispose settles pending requests', async () => {
    const { worker, sent, reply } = fakeWorker();
    const client = createSolverClient(worker);
    let settled: unknown = 'pending';
    const p = client.solve(createWorld(), 'f').then((v) => (settled = v));
    reply({ type: 'solved', id: sent[0]!.id + 99, plan: plan(1), ms: 1 });
    await flush();
    expect(settled).toBe('pending');
    client.dispose();
    await p;
    expect(settled).toBeNull();
    expect(worker.terminated).toBe(true);
  });
});
