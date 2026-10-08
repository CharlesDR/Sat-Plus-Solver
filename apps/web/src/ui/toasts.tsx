/**
 * Short confirmations that pop up in a corner and fade, so an action's
 * feedback doesn't push the page around. Errors stay where they happened;
 * toasts are for things that worked.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CloseIcon } from './icons';

/** A button on a toast, such as Undo; the toast closes when it is used. */
export interface ToastAction {
  label: string;
  run(): void;
}

interface Toast {
  id: number;
  text: string;
  action?: ToastAction | undefined;
}

type Show = (text: string, action?: ToastAction) => void;

const ToastContext = createContext<Show>(() => {});

/** Shows a toast; a no-op outside a `ToastProvider`. */
export const useToast = () => useContext(ToastContext);

const LIFETIME_MS = 3500;
/** A toast with an action stays long enough to use it (N3). */
const ACTION_LIFETIME_MS = 30_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);
  const show = useCallback<Show>(
    (text, action) => {
      const id = ++next.current;
      // At most three at once; the oldest goes first.
      setToasts((ts) => [...ts.slice(-2), { id, text, action }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), action ? ACTION_LIFETIME_MS : LIFETIME_MS),
      );
    },
    [dismiss],
  );
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-label="Notifications" role="region">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
