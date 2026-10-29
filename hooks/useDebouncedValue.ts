import { useEffect, useState } from 'react';

/** The value, but only after it has stopped changing for `delayMs` — so typing in a search box asks the server once, not on every key. */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
