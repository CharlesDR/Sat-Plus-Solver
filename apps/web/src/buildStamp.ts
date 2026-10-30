/**
 * Which build is running (R1): the short commit SHA and build date, set at
 * build time by vite.config.ts from `GITHUB_SHA`, so Charles can tell
 * whether a deploy has reached him. Dev servers and tests read "local".
 */
declare const __BUILD__: { sha: string; date: string } | undefined;

export const BUILD_STAMP =
  typeof __BUILD__ === 'object' ? `Build ${__BUILD__.sha} · ${__BUILD__.date}` : 'Build local';
