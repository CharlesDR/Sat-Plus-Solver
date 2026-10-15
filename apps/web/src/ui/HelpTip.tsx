/**
 * Hover help: one tooltip for the whole page. Hovering or focusing an element
 * with `data-help` shows its text from `help.ts` after a short delay, so
 * passing over does not flash; it stays while the pointer or focus is on the
 * element and fades out on leave. Not a native `title` tooltip.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { helpText } from '../help';

/** Show delay, ms. */
export const HELP_DELAY = 400;
/** Gap between the element and the tip, px. */
const GAP = 6;

type Box = { left: number; top: number; width: number; height: number };

/**
 * Where the tip goes: below the element, or above when it would leave the
 * viewport; kept inside it horizontally.
 */
export function placeTip(
  target: Box,
  tip: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const below = target.top + target.height + GAP;
  const top =
    below + tip.height > view.height && target.top - GAP - tip.height >= 0
      ? target.top - GAP - tip.height
      : below;
  const left = Math.min(
    Math.max(GAP, target.left + target.width / 2 - tip.width / 2),
    Math.max(GAP, view.width - tip.width - GAP),
  );
  return { left, top };
}

type Shown = { el: HTMLElement; text: string };

export function HelpTip() {
  const id = useId();
  const [shown, setShown] = useState<Shown>();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | undefined;
    const helpOf = (node: EventTarget | null) => {
      const el = node instanceof Element ? node.closest<HTMLElement>('[data-help]') : null;
      const text = helpText(el?.dataset.help);
      return el && text ? { el, text } : undefined;
    };
    const enter = (e: Event) => {
      const hit = helpOf(e.target);
      if (hit?.el === current) return;
      clearTimeout(timer);
      current = hit?.el;
      if (!hit) return setVisible(false);
      timer = setTimeout(() => {
        setShown(hit);
        setVisible(true);
      }, HELP_DELAY);
    };
    const leave = (e: Event) => {
      const to = (e as FocusEvent | PointerEvent).relatedTarget;
      if (current && to instanceof Node && current.contains(to)) return;
      clearTimeout(timer);
      current = undefined;
      setVisible(false);
    };
    const hide = () => {
      clearTimeout(timer);
      current = undefined;
      setVisible(false);
    };
    document.addEventListener('pointerover', enter);
    document.addEventListener('pointerout', leave);
    document.addEventListener('focusin', enter);
    document.addEventListener('focusout', leave);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', enter);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('focusin', enter);
      document.removeEventListener('focusout', leave);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', hide);
    };
  }, []);

  // Place the tip once it has a size, and describe the element by it while shown.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!shown || !tip) return;
    const r = shown.el.getBoundingClientRect();
    setPos(
      placeTip(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        { width: tip.offsetWidth, height: tip.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    if (!visible) return;
    const el = shown.el;
    const before = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', before ? `${before} ${id}` : id);
    return () => {
      if (before === null) el.removeAttribute('aria-describedby');
      else el.setAttribute('aria-describedby', before);
    };
  }, [shown, visible, id]);

  if (!shown) return null;
  return (
    <div
      ref={tipRef}
      id={id}
      role="tooltip"
      className={`help-tip${visible && pos ? ' shown' : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
      onTransitionEnd={() => !visible && setShown(undefined)}
    >
      {shown.text}
    </div>
  );
}
