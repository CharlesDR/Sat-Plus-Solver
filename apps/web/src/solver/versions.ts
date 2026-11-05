/**
 * The SF+ mod versions this build ships (A111), from `pnpm build:data`'s
 * data/generated/<version>/model.json, oldest first. Only a version's URL is
 * bundled; its worker fetches the model.
 */
import { compareModVersions, type Model } from '@sps/data';

const urls = import.meta.glob<string>('../../../../data/generated/*/model.json', {
  query: '?url',
  import: 'default',
  eager: true,
});

const byVersion = new Map(
  Object.entries(urls).map(([path, url]) => [path.split('/').at(-2)!, url] as const),
);

/** Every shipped version, oldest first. */
export const MOD_VERSIONS: readonly string[] = [...byVersion.keys()].sort(compareModVersions);

/** What new worlds start on. */
export const NEWEST_VERSION: string = MOD_VERSIONS.at(-1) ?? '';

/** The version a world solves on: its own when this build has it, else the newest. */
export function solvableVersion(version: string | undefined): string {
  return version !== undefined && byVersion.has(version) ? version : NEWEST_VERSION;
}

/** Where a shipped version's model is served. */
export function modelUrl(version: string): string {
  const url = byVersion.get(version);
  if (url === undefined) throw new Error(`No model for SF+ ${version}.`);
  return url;
}

/** A shipped version's model, or undefined for one this build lacks. */
export async function loadModel(version: string | undefined): Promise<Model | undefined> {
  if (version === undefined || !byVersion.has(version)) return undefined;
  const res = await fetch(modelUrl(version));
  if (!res.ok) throw new Error(`Could not load the SF+ ${version} model (${res.status}).`);
  return (await res.json()) as Model;
}
