// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

let fail = true;
function Fragile() {
  if (fail) throw new Error('bad layout');
  return <p>fine</p>;
}

describe('ErrorBoundary (M10)', () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // React reports caught errors on the console; the test checks the fallback instead.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    fail = true;
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const render = (resetKey: string) =>
    act(() =>
      root.render(
        <div>
          <p>outside</p>
          <ErrorBoundary
            what="the flowchart"
            resetKey={resetKey}
            recovery={<button>Export</button>}
          >
            <Fragile />
          </ErrorBoundary>
        </div>,
      ),
    );

  test('shows the error in place, keeps the rest, and retries on request', () => {
    render('a');
    const alert = host.querySelector('[role=alert]')!;
    expect(alert.textContent).toContain('Something went wrong in the flowchart: bad layout');
    expect(host.textContent).toContain('outside');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Try again',
      'Export',
    ]);
    fail = false;
    act(() => host.querySelector('button')!.click());
    expect(host.textContent).toContain('fine');
    expect(host.querySelector('[role=alert]')).toBeNull();
  });

  test('a new reset key clears the error', () => {
    render('a');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    fail = false;
    render('a');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    render('b');
    expect(host.textContent).toContain('fine');
  });
});
