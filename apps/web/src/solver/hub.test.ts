import { describe, expect, test, vi } from 'vitest';
import type { SolverClient } from './client';
import { createSolverHub } from './hub';

describe('solver hub (A111)', () => {
  test('starts one client per version, once, and stops the others on request', () => {
    const disposed: string[] = [];
    const start = vi.fn(
      (v: string) => ({ dispose: () => disposed.push(v) }) as unknown as SolverClient,
    );
    const hub = createSolverHub(start);
    const a = hub.client('1');
    expect(hub.client('1')).toBe(a);
    const b = hub.client('2');
    expect(start).toHaveBeenCalledTimes(2);
    hub.keepOnly('2');
    expect(disposed).toEqual(['1']);
    expect(hub.client('2')).toBe(b);
    expect(hub.client('1')).not.toBe(a);
    expect(start).toHaveBeenCalledTimes(3);
  });
});
