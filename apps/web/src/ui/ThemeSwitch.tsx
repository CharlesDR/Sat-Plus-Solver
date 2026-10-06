import type { ReactNode } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';
import { useTheme, type Theme } from './prefs';

const OPTIONS: { value: Theme; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System theme', icon: <MonitorIcon /> },
  { value: 'light', label: 'Light theme', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark theme', icon: <MoonIcon /> },
];

/** Light, dark, or the browser's own scheme; remembered in this browser. */
export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="segmented icon-only" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => setTheme(o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
