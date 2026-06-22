'use client';

/**
 * Debounce a value (STAP 3.5b · #1b). The `<input>` stays controlled + instantly
 * responsive; the EXPENSIVE work (filtering/flattening 1500 rows) reads the
 * debounced value, so we don't re-filter on every keystroke. Local-only — never
 * a network round-trip (the door is offline-first, #27).
 *
 * Returns the latest value after `delay` ms of no further updates. The first
 * value is emitted synchronously (no initial flash of empty/stale results).
 */
import { useEffect, useRef, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay = 140): T {
  const [debounced, setDebounced] = useState(value);
  // First render emits immediately; only subsequent changes are debounced.
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
