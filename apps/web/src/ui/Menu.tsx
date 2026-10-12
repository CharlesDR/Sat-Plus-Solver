/**
 * Dropdown menus: the File menu, the world's "⋯" menu (UX-10) and the
 * Factories table's row menus (UX-11). A menu is a `<details>` that closes on
 * Escape, on a click outside it and when one of its actions runs.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

/** Closes the menu in `menu` on Escape (focus back on its button) and on a click outside it. */
export function useMenuDismiss(menu: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const close = () => menu.current?.removeAttribute('open');
    const onClick = (e: MouseEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menu.current?.open) {
        // Handled: Esc closes the menu and goes no further (A42).
        e.preventDefault();
        close();
        menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);
}

/** Puts a fixed menu panel under (or, short of room, over) its button. */
function place(menu: HTMLDetailsElement | null, panel: HTMLDivElement | null) {
  if (!menu?.open || !panel) return;
  const r = menu.querySelector('summary')!.getBoundingClientRect();
  const below = r.bottom + 4;
  const room = window.innerHeight - below;
  panel.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  if (room < panel.offsetHeight + 8 && r.top > room) {
    panel.style.top = 'auto';
    panel.style.bottom = `${window.innerHeight - r.top + 4}px`;
  } else {
    panel.style.bottom = 'auto';
    panel.style.top = `${below}px`;
  }
}

/**
 * A "⋯" menu; a click on one of its buttons closes it. `fixed` places the
 * panel in the viewport next to its button, for menus inside a scrolling
 * table that would otherwise clip it, and keeps it there as the page scrolls.
 */
export function MoreMenu(props: {
  label: string;
  title?: string;
  fixed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { label, title, fixed = false, className, children } = props;
  const menu = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useMenuDismiss(menu);
  const close = () => menu.current?.removeAttribute('open');

  useEffect(() => {
    if (!fixed) return;
    const follow = () => place(menu.current, panel.current);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [fixed]);

  return (
    <details
      ref={menu}
      className={['menu more-menu', className].filter(Boolean).join(' ')}
      onToggle={() => {
        if (fixed) place(menu.current, panel.current);
      }}
    >
      <summary aria-label={label} title={title ?? label}>
        <span aria-hidden="true">⋯</span>
      </summary>
      {/* A button in the panel is an action: the menu closes as it runs. */}
      <div
        ref={panel}
        className={fixed ? 'menu-panel more-panel fixed' : 'menu-panel more-panel'}
        onClick={(e) => {
          if ((e.target as Element).closest('button')) close();
        }}
      >
        {children}
      </div>
    </details>
  );
}
