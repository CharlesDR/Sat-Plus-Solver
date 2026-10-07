/**
 * Esc steps back one thing at a time (A42): it leaves a text field first,
 * then closes the most recently opened layer (a selection, and later the node
 * tooltip), and only then backs out one level of the view path.
 */
import { createContext, useContext, useEffect, useRef } from 'react';

export interface EscapeStack {
  /** Opens a layer that Esc closes; returns the function that removes it. */
  push(close: () => void): () => void;
  /** Closes the most recently opened layer; false if none is open. */
  pop(): boolean;
}

export function escapeStack(): EscapeStack {
  const layers: { close: () => void }[] = [];
  return {
    push(close) {
      const layer = { close };
      layers.push(layer);
      return () => {
        const k = layers.indexOf(layer);
        if (k >= 0) layers.splice(k, 1);
      };
    },
    pop() {
      const layer = layers.pop();
      layer?.close();
      return layer !== undefined;
    },
  };
}

/** Text a user types into, which Esc leaves before it does anything else. */
export function isTextField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  return !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/.test(
    (el as HTMLInputElement).type,
  );
}

export const EscapeContext = createContext<EscapeStack | undefined>(undefined);

/** While `open`, Esc calls `close` before anything opened earlier. */
export function useEscapeLayer(open: boolean, close: () => void) {
  const stack = useContext(EscapeContext);
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!open || !stack) return;
    return stack.push(() => latest.current());
  }, [open, stack]);
}
