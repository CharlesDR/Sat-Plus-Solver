import { WorldLoadError, createWorld, migrateWorld } from '@sps/world';
import { describe, expect, test } from 'vitest';
import v1 from '../../../../fixtures/worlds/v1-world.json';
import v4 from '../../../../fixtures/worlds/v4-world.json';
import { SHARE_LIMIT, isShareHash, readShareHash, shareLink } from './share';
import { bigWorld } from './testing';

const BASE = 'https://example.test/app/?x=1#old';

/** The fragment of a share URL. */
const fragment = (url: string) => new URL(url).hash;

describe('share links (PLAN M9)', () => {
  test('World → URL → World is deep-equal', () => {
    for (const world of [createWorld('h'), v4, bigWorld(20)]) {
      const link = shareLink(world as never, BASE);
      if (!link.ok) throw new Error('expected a link');
      expect(link.url.startsWith('https://example.test/app/?x=1#w=')).toBe(true);
      expect(isShareHash(fragment(link.url))).toBe(true);
      expect(readShareHash(fragment(link.url))).toStrictEqual(world);
      expect(link.bytes).toBeLessThan(SHARE_LIMIT);
    }
  });

  test('an old version in a link migrates on open', () => {
    const link = shareLink(v1 as never, BASE);
    if (!link.ok) throw new Error('expected a link');
    expect(readShareHash(fragment(link.url))).toStrictEqual(migrateWorld(v1));
  });

  test('a world too big for a link falls back to export', () => {
    const link = shareLink(bigWorld(400), BASE);
    expect(link.ok).toBe(false);
    expect(link).toMatchObject({ limit: SHARE_LIMIT });
    expect(link.bytes).toBeGreaterThanOrEqual(SHARE_LIMIT);
  });

  test('a damaged or foreign fragment is refused', () => {
    expect(isShareHash('#factory-1')).toBe(false);
    expect(() => readShareHash('#w=')).toThrow(/damaged/);
    const link = shareLink(createWorld(), BASE);
    if (!link.ok) throw new Error('expected a link');
    expect(() => readShareHash(fragment(link.url).slice(0, 40))).toThrow();
    const notWorld = shareLink({ meta: { v: 3 } } as never, BASE);
    if (!notWorld.ok) throw new Error('expected a link');
    expect(() => readShareHash(fragment(notWorld.url))).toThrow(WorldLoadError);
  });
});
