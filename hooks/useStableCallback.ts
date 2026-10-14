import { useCallback, useRef } from 'react';

/**
 * Returns a function identity that never changes, but always invokes the
 * latest `fn` passed in. For effects that must only run once per mount
 * (e.g. opening a realtime subscription) whose callback closes over
 * fast-changing state (a search box, a filter chip) — without this, an
 * effect depending on that callback's identity re-subscribes on every
 * keystroke, tearing down and reopening the underlying channel instead
 * of just re-running with fresh state on the next real event.
 */
export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: never[]) => ref.current(...args)) as T, []);
}
