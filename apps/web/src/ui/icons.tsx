/** Small line icons for buttons. They are decorative: the button carries the name. */
import type { ReactNode } from 'react';

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Icon>
);

export const MonitorIcon = () => (
  <Icon>
    <rect x="2" y="4" width="20" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </Icon>
);

export const FileIcon = () => (
  <Icon>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon size={14}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon size={14}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Icon>
);

export const SidebarIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Icon>
);

export const FitIcon = () => (
  <Icon>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
  </Icon>
);

/** The app mark: a factory's three belts, as in the favicon. */
export const LogoMark = () => (
  <svg className="logo" width="24" height="24" viewBox="0 0 16 16" aria-hidden="true">
    <rect width="16" height="16" rx="4" fill="var(--accent)" />
    <path d="M4 11h8M4 8h5M4 5h8" stroke="var(--accent-fg)" strokeWidth="1.6" />
  </svg>
);
