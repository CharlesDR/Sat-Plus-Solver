/**
 * Per-browser display preferences (theme, sidebar). They are not part of the
 * world document, so they never travel with a save or a share link. Every
 * storage access is wrapped in try/catch (CLAUDE.md): without storage the
 * defaults apply and nothing else changes.
 */
import { useCallback, useState } from 'react';
import { isStatsScope, type StatsScope } from '../stats/scope';

export type Theme = 'system' | 'light' | 'dark';

const KEY = {
  theme: 'sps:pref:theme',
  sidebar: 'sps:pref:sidebar',
  view: 'sps:pref:view',
  recent: 'sps:pref:recent-targets',
  precise: 'sps:pref:precise-numbers',
  viewports: 'sps:pref:viewports',
  planTab: 'sps:pref:plan-tab',
  statsScope: 'sps:pref:stats-scope',
} as const;

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

/**
 * Whether a collapsible section is open (UX-A). It starts open only while it
 * is `active` (a build mark, a parent, a changed advanced value); a user's
 * toggle is remembered per section and per active state, so opening the Build
 * panel once on an unbuilt factory doesn't open it on every factory.
 */
export function useOpenPref(section: string, active = false): [boolean, (open: boolean) => void] {
  const key = `sps:pref:open:${section}:${active ? 'active' : 'idle'}`;
  const [, bump] = useState(0);
  const stored = read(key);
  const open = stored === undefined ? active : stored === 'open';
  const set = useCallback(
    (o: boolean) => {
      write(key, o ? 'open' : 'closed');
      bump((n) => n + 1);
    },
    [key],
  );
  return [open, set];
}

/** What the factory plan shows: the flowchart, the tables, or both (UX-3). */
export type PlanView = 'both' | 'graph' | 'table';
const isPlanView = (x: unknown): x is PlanView => x === 'both' || x === 'graph' || x === 'table';

export function usePlanView(): [PlanView, (v: PlanView) => void] {
  const [view, setView] = useState<PlanView>(() => {
    const v = read(KEY.view);
    return isPlanView(v) ? v : 'both';
  });
  const set = useCallback((v: PlanView) => {
    setView(v);
    write(KEY.view, v);
  }, []);
  return [view, set];
}

/** How many recent targets the Targets editor offers as chips (UX-12). */
export const RECENT_TARGETS = 6;

/** Item ids, most recent first. */
export function readRecentTargets(): string[] {
  try {
    const v: unknown = JSON.parse(read(KEY.recent) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Puts items first in the recent list, without repeats, and keeps the newest few. */
export function withRecent(recent: readonly string[], items: readonly string[]): string[] {
  return [...new Set([...items, ...recent])].slice(0, RECENT_TARGETS);
}

export function writeRecentTargets(items: readonly string[]): void {
  write(KEY.recent, JSON.stringify(items));
}

/** Whether numbers show in full (A41) instead of the quiet 2 decimals (UX-6, A78). */
export function usePreciseNumbers(): [boolean, (precise: boolean) => void] {
  const [precise, setPrecise] = useState(() => read(KEY.precise) === 'on');
  const set = useCallback((p: boolean) => {
    setPrecise(p);
    write(KEY.precise, p ? 'on' : 'off');
  }, []);
  return [precise, set];
}

/** Which table the bottom of the plan summary shows (UX-4). */
export type PlanTab = 'recipes' | 'items';

export function usePlanTab(): [PlanTab, (t: PlanTab) => void] {
  const [tab, setTab] = useState<PlanTab>(() =>
    read(KEY.planTab) === 'items' ? 'items' : 'recipes',
  );
  const set = useCallback((t: PlanTab) => {
    setTab(t);
    write(KEY.planTab, t);
  }, []);
  return [tab, set];
}

/** What the plan stats sum over (UI-9, A81); Current & Below by default. */
export function useStatsScope(): [StatsScope, (s: StatsScope) => void] {
  const [scope, setScope] = useState<StatsScope>(() => {
    const s = read(KEY.statsScope);
    return isStatsScope(s) ? s : 'current-below';
  });
  const set = useCallback((s: StatsScope) => {
    setScope(s);
    write(KEY.statsScope, s);
  }, []);
  return [scope, set];
}

/** A flowchart's pan and zoom, with the size of the plan drawing it was left on. */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

/** How many factories' flowchart views are remembered (UX-13); the oldest go first. */
export const VIEWPORTS = 50;

const isViewport = (v: unknown): v is Viewport =>
  typeof v === 'object' &&
  v !== null &&
  ['x', 'y', 'zoom', 'width', 'height'].every((k) =>
    Number.isFinite((v as Record<string, unknown>)[k]),
  ) &&
  (v as Viewport).zoom > 0;

function readViewports(): [string, Viewport][] {
  try {
    const v: unknown = JSON.parse(read(KEY.viewports) ?? '[]');
    return Array.isArray(v)
      ? v.filter(
          (e): e is [string, Viewport] =>
            Array.isArray(e) && typeof e[0] === 'string' && isViewport(e[1]),
        )
      : [];
  } catch {
    return [];
  }
}

/** The flowchart view last left in this factory (UX-13), if any. */
export function readViewport(factory: string): Viewport | undefined {
  return readViewports().find(([id]) => id === factory)?.[1];
}

/** Remembers a factory's flowchart view, newest first, keeping the last `VIEWPORTS`. */
export function writeViewport(factory: string, view: Viewport): void {
  const rest = readViewports().filter(([id]) => id !== factory);
  write(KEY.viewports, JSON.stringify([[factory, view], ...rest].slice(0, VIEWPORTS)));
}
