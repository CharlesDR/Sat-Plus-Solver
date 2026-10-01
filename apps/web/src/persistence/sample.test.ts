/**
 * The README's "open the sample world" link (M10) carries exactly
 * `examples/world.json`, so the two cannot drift apart.
 */
import { readFileSync } from 'node:fs';
import { parseWorld } from '@sps/world';
import { expect, test } from 'vitest';
import { readShareHash, shareLink } from './share';

const root = new URL('../../../../', import.meta.url);
const PAGES_URL = 'https://charlesdr.github.io/Sat-Plus-Solver/';

test('the README sample-world link opens examples/world.json', () => {
  const sample = parseWorld(readFileSync(new URL('examples/world.json', root), 'utf8'));
  const link = shareLink(sample, PAGES_URL);
  expect(link.ok).toBe(true);
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const found = readme.match(/https:\/\/charlesdr\.github\.io\/Sat-Plus-Solver\/#w=[\w$+\-.]+/g);
  // When this fails after editing the sample, paste the expected link into the README.
  expect(found).toEqual([link.ok && link.url]);
  expect(readShareHash(new URL(found![0]!).hash)).toEqual(sample);
});
