import { readFileSync } from 'node:fs';
import { WorldLoadError, createWorld, migrateWorld, parseWorld, serializeWorld } from '@sps/world';
import lzString from 'lz-string';
import { describe, expect, test } from 'vitest';
import v1 from '../../../../fixtures/worlds/v1-world.json';
import v16 from '../../../../fixtures/worlds/v16-world.json';
import v17 from '../../../../fixtures/worlds/v17-world.json';
import { SHARE_LIMIT, isShareHash, readShareHash, shareLink } from './share';
import { bigWorld } from './testing';

const BASE = 'https://example.test/app/?x=1#old';

/** The fragment of a share URL. */
const fragment = (url: string) => new URL(url).hash;

/** A link as the app made it before A108. */
const lzHash = (world: unknown) =>
  `#w=${lzString.compressToEncodedURIComponent(JSON.stringify(world))}`;

describe('share links (PLAN M9, A108)', () => {
  test('World → URL → World is deep-equal', async () => {
    for (const world of [createWorld('h'), v17, bigWorld(20)]) {
      const link = await shareLink(world as never, BASE);
      if (!link.ok) throw new Error('expected a link');
      expect(link.url).toMatch(/^https:\/\/example\.test\/app\/\?x=1#z=[\w-]+$/);
      expect(isShareHash(fragment(link.url))).toBe(true);
      expect(await readShareHash(fragment(link.url))).toStrictEqual(world);
      expect(link.bytes).toBeLessThan(SHARE_LIMIT);
    }
  });

  test('an old version in a link migrates on open', async () => {
    const link = await shareLink(v1 as never, BASE);
    if (!link.ok) throw new Error('expected a link');
    expect(await readShareHash(fragment(link.url))).toStrictEqual(migrateWorld(v1));
  });

  test('links made before A108 (#w=, lz-string) still open', async () => {
    expect(isShareHash(lzHash(v16))).toBe(true);
    expect(await readShareHash(lzHash(v16))).toStrictEqual(migrateWorld(v16));
    expect(await readShareHash(lzHash(v1))).toStrictEqual(migrateWorld(v1));
  });

  test('a link is about half as long as the old format (sample world)', async () => {
    const root = new URL('../../../../', import.meta.url);
    const sample = parseWorld(readFileSync(new URL('examples/world.json', root), 'utf8'));
    const link = await shareLink(sample, BASE);
    if (!link.ok) throw new Error('expected a link');
    const old = lzHash(JSON.parse(serializeWorld(sample))).length - 3;
    expect(link.bytes).toBeLessThan(0.6 * old);
  });

  test('a world too big for a link falls back to export', async () => {
    const link = await shareLink(bigWorld(400), BASE);
    expect(link.ok).toBe(false);
    expect(link).toMatchObject({ limit: SHARE_LIMIT });
    expect(link.bytes).toBeGreaterThanOrEqual(SHARE_LIMIT);
  });

  test('a damaged or foreign fragment is refused', async () => {
    expect(isShareHash('#factory-1')).toBe(false);
    await expect(readShareHash('#w=')).rejects.toThrow(/damaged/);
    await expect(readShareHash('#z=')).rejects.toThrow(/damaged/);
    await expect(readShareHash('#z=not+base64url')).rejects.toThrow(/damaged/);
    const link = await shareLink(createWorld(), BASE);
    if (!link.ok) throw new Error('expected a link');
    await expect(readShareHash(fragment(link.url).slice(0, 40))).rejects.toThrow(/damaged/);
    const notWorld = await shareLink({ meta: { v: 3 } } as never, BASE);
    if (!notWorld.ok) throw new Error('expected a link');
    await expect(readShareHash(fragment(notWorld.url))).rejects.toThrow(WorldLoadError);
  });
});
