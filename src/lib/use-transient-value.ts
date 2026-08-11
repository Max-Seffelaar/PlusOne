'use client';

/**
 * A value that appears for `ttlMs` then reverts to `null` — toasts, flash
 * highlights, and similar "show briefly then clear" UI. Precedent:
 * use-debounced-value.ts.
 *
 * `trigger(value)` clears any pending timer before arming a new one, so an
 * earlier trigger's timer can never fire after a later value was set and wipe
 * it prematurely (86ey9ea1g — the home.tsx toast had exactly this bug before
 * this hook existed).
 *
 * Unmount clears the pending timer AND flips a mounted ref so a `trigger`
 * call landing after unmount is a no-op instead of a setState-after-unmount
 * warning or a timer outliving its component. This matters beyond a plain
 * effect-cleanup: several call sites arm a toast from an async completion —
 * a mutation's `onError`/`onSuccess`, a background sync's result — which can
 * land after the user has already navigated away.
 *
 * `clear()` reverts to `null` immediately and cancels the pending timer,
 * without arming a new one — for a caller that needs to explicitly dismiss
 * the value early (e.g. resetting a stale "Copied!" flag when a fresh link
 * is minted, before anything has actually been copied for it).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useTransientValue<T>(ttlMs: number): [T | null, (value: T) => void, () => void] {
  const [value, setValue] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const trigger = useCallback(
    (next: T) => {
      if (!mountedRef.current) return;
      setValue(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (mountedRef.current) setValue(null);
      }, ttlMs);
    },
    [ttlMs]
  );

  const clear = useCallback(() => {
    if (!mountedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setValue(null);
  }, []);

  return [value, trigger, clear];
}
