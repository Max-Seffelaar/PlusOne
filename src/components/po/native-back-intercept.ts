'use client';

/**
 * Lets a screen claim the Android hardware back button for local UI state
 * before `nativeBackAction` routes it (Fase 17 N3 follow-up, 86ey6bfdm).
 *
 * Why: the standalone door's sheets (`/door/<eventId>`: guest detail, add on
 * the spot) are React state in `DoorRoute`, not history entries like the
 * `/app` door's `?guest=`/`?add=`. Without an intercept, back replaces to the
 * `/door` picker and unloads the whole door mid-check-in. Closing a sheet is
 * pure local state: no navigation, no `DoorProvider` remount, works offline
 * (#25), so an intercept always runs before the online/offline route rules.
 *
 * A stack, newest first: the most recently activated intercept (the topmost
 * sheet) handles back. An intercept is registered only while it is active
 * (`onBack !== null`), so an inactive screen never swallows a back press.
 */
import { useEffect, useRef } from 'react';

type Intercept = { current: () => void };
const stack: Intercept[] = [];

/** Runs the newest active intercept. `true` = back was handled; route nothing. */
export function runNativeBackIntercept(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.current();
  return true;
}

/**
 * While `onBack` is non-null, the hardware back button calls it instead of
 * navigating. Pass `null` when there is nothing local to close.
 */
export function useNativeBackIntercept(onBack: (() => void) | null): void {
  const ref = useRef<Intercept>({ current: () => undefined });
  const active = onBack !== null;
  useEffect(() => {
    if (onBack) ref.current.current = onBack;
  });
  useEffect(() => {
    if (!active) return;
    const entry = ref.current;
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i !== -1) stack.splice(i, 1);
    };
  }, [active]);
}
