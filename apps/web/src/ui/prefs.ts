/**
 * Per-browser display preferences (theme, sidebar). They are not part of the
 * world document, so they never travel with a save or a share link. Every
 * storage access is wrapped in try/catch (CLAUDE.md): without storage the
 * defaults apply and nothing else changes.
 */
import { useCallback, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';

const KEY = { theme: 'sps:pref:theme', sidebar: 'sps:pref:sidebar' } as const;

function read(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // No storage: the preference lasts for this page only.
  }
}

export const isTheme = (x: unknown): x is Theme => x === 'system' || x === 'light' || x === 'dark';

export function readTheme(): Theme {
  const t = read(KEY.theme);
  return isTheme(t) ? t : 'system';
}

/** Sets the theme on the document: `system` follows the browser's colour scheme. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const set = useCallback((t: Theme) => {
    setTheme(t);
    applyTheme(t);
    write(KEY.theme, t);
  }, []);
  return [theme, set];
}

/** Whether the factory settings sidebar is open (it is by default). */
export function useSidebarOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => read(KEY.sidebar) !== 'closed');
  const set = useCallback((o: boolean) => {
    setOpen(o);
    write(KEY.sidebar, o ? 'open' : 'closed');
  }, []);
  return [open, set];
}
