/**
 * Esc steps back one thing at a time (A42): it leaves a text field first,
 * then closes the most recently opened layer (a selection, and later the node
 * tooltip), and only then backs out one level of the view path.
 */
import { createContext, useContext, useEffect, useRef } from 'react';

export interface EscapeStack {
  /**
   * Opens a layer that Esc closes; returns the function that removes it.
   * `above`: the layer sits over the plain ones whenever they opened, as a
   * popup does over the selection it opened with (A48).
   */
  push(close: () => void, above?: boolean): () => void;
  /** Closes the most recently opened layer; false if none is open. */
  pop(): boolean;
}

export function escapeStack(): EscapeStack {
  const layers: { close: () => void; above: boolean }[] = [];
  return {
    push(close, above = false) {
      const layer = { close, above };
      layers.push(layer);
      return () => {
        const k = layers.indexOf(layer);
        if (k >= 0) layers.splice(k, 1);
      };
    },
    pop() {
      const top = layers.findLastIndex((l) => l.above);
      const [layer] = layers.splice(top >= 0 ? top : layers.length - 1, 1);
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

/**
 * While `open`, Esc calls `close` before anything opened earlier. `above`:
 * before any plain layer, even one opened later in the same click, such as
 * the selection that the node tooltip opens with (A48).
 */
export function useEscapeLayer(
  open: boolean,
  close: () => void,
  options: { above?: boolean } = {},
) {
  const stack = useContext(EscapeContext);
  const latest = useRef(close);
  const above = options.above === true;
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!open || !stack) return;
    return stack.push(() => latest.current(), above);
  }, [open, stack, above]);
}
