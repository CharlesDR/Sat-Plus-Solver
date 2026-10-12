import { useEffect, useState } from 'react';

/** Below this width the settings sidebar is an off-canvas drawer (UX-14). */
export const DRAWER_QUERY = '(max-width: 1100px)';

const mediaList = (query: string) =>
  typeof window.matchMedia === 'function' ? window.matchMedia(query) : undefined;

/** Whether `query` matches now, kept current as the window changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaList(query)?.matches ?? false);
  useEffect(() => {
    const m = mediaList(query);
    if (!m) return;
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}
