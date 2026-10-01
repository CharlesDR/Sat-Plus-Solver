/**
 * Share links (PLAN M9, ARCHITECTURE §8): the world as compressed JSON in
 * the URL fragment, `#w=<lz-string>`, when that payload is under
 * `SHARE_LIMIT` bytes. Bigger worlds are exported as a file instead (R6).
 */
import { parseWorld, serializeWorld, type World } from '@sps/world';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

/** Bytes of compressed payload a share link may carry. */
export const SHARE_LIMIT = 8 * 1024;
const PREFIX = '#w=';

export type ShareLink =
  { ok: true; url: string; bytes: number } | { ok: false; bytes: number; limit: number };

/** The share link for `world` on top of `base` (the app's URL), or why there is none. */
export function shareLink(world: World, base: string): ShareLink {
  const payload = compressToEncodedURIComponent(serializeWorld(world));
  // URI-component-safe output is ASCII, so its length is its size in bytes.
  const bytes = payload.length;
  if (bytes >= SHARE_LIMIT) return { ok: false, bytes, limit: SHARE_LIMIT };
  const url = new URL(base);
  url.hash = '';
  return { ok: true, url: `${url.href}${PREFIX}${payload}`, bytes };
}

/** True when a URL fragment carries a shared world. */
export function isShareHash(hash: string): boolean {
  return hash.startsWith(PREFIX);
}

/**
 * The world in a share-link fragment. Throws `WorldLoadError` (or a plain
 * `Error` for a damaged payload) when it can't be read.
 */
export function readShareHash(hash: string): World {
  const text = decompressFromEncodedURIComponent(hash.slice(PREFIX.length));
  if (!text) throw new Error('The share link is damaged or incomplete.');
  return parseWorld(text);
}
