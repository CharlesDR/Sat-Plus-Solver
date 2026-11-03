/**
 * Share links (PLAN M9, ARCHITECTURE §8, A108): the world as compressed JSON
 * in the URL fragment, `#z=<deflate-raw in base64url>`, when that payload is
 * under `SHARE_LIMIT` bytes. Bigger worlds are exported as a file instead
 * (R6). Links made before A108, `#w=<lz-string>`, still open.
 */
import { parseWorld, serializeWorld, type World } from '@sps/world';
import lzString from 'lz-string';

/** Bytes of compressed payload a share link may carry. */
export const SHARE_LIMIT = 8 * 1024;
const PREFIX = '#z=';
/** Links made before A108. */
const LZ_PREFIX = '#w=';

export type ShareLink =
  { ok: true; url: string; bytes: number } | { ok: false; bytes: number; limit: number };

const damaged = () => new Error('The share link is damaged or incomplete.');

/** `bytes` through a browser-native compression or decompression stream. */
async function through(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** URL-safe base64 without padding (RFC 4648 §5). */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let k = 0; k < bytes.length; k += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]*$/.test(text)) throw damaged();
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The share link for `world` on top of `base` (the app's URL), or why there is none. */
export async function shareLink(world: World, base: string): Promise<ShareLink> {
  const json = new TextEncoder().encode(serializeWorld(world));
  const payload = toBase64Url(await through(json, new CompressionStream('deflate-raw')));
  // Base64url is ASCII, so its length is its size in bytes.
  const bytes = payload.length;
  if (bytes >= SHARE_LIMIT) return { ok: false, bytes, limit: SHARE_LIMIT };
  const url = new URL(base);
  url.hash = '';
  return { ok: true, url: `${url.href}${PREFIX}${payload}`, bytes };
}

/** True when a URL fragment carries a shared world, in either format. */
export function isShareHash(hash: string): boolean {
  return hash.startsWith(PREFIX) || hash.startsWith(LZ_PREFIX);
}

/** The world JSON in a share-link fragment. */
async function shareText(hash: string): Promise<string> {
  if (hash.startsWith(LZ_PREFIX)) {
    const text = lzString.decompressFromEncodedURIComponent(hash.slice(LZ_PREFIX.length));
    if (!text) throw damaged();
    return text;
  }
  if (!hash.startsWith(PREFIX)) throw new Error('This is not a share link.');
  try {
    const bytes = await through(
      fromBase64Url(hash.slice(PREFIX.length)),
      new DecompressionStream('deflate-raw'),
    );
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text) throw damaged();
    return text;
  } catch {
    throw damaged();
  }
}

/**
 * The world in a share-link fragment. Rejects with `WorldLoadError` (or a
 * plain `Error` for a damaged payload) when it can't be read.
 */
export async function readShareHash(hash: string): Promise<World> {
  return parseWorld(await shareText(hash));
}
