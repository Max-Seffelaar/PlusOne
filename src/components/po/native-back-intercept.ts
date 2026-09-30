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
 *
 * Leave guards are a separate slot, consulted only when back is about to
 * navigate: an open sheet always closes first, whatever a guard says.
 */
import { useEffect, useRef } from 'react';

type Slot<F> = { current: F };
const stack: Slot<() => void>[] = [];
const leaveGuards: Slot<(leave: () => void) => void>[] = [];

/** Runs the newest active intercept. `true` = back was handled; route nothing. */
export function runNativeBackIntercept(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.current();
  return true;
}

/**
 * Asks the newest active leave guard before back navigates away from the
 * current route. `true` = the guard took over: it calls `leave` itself only
 * once the user confirms. `false` = no guard; navigate now.
 */
export function runNativeLeaveGuard(leave: () => void): boolean {
  const top = leaveGuards[leaveGuards.length - 1];
  if (!top) return false;
  top.current(leave);
  return true;
}

function useRegistered<F>(registry: Slot<F>[], fn: F | null, noop: F): void {
  const ref = useRef<Slot<F>>({ current: noop });
  const active = fn !== null;
  useEffect(() => {
    if (fn !== null) ref.current.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    const entry = ref.current;
    registry.push(entry);
    return () => {
      const i = registry.lastIndexOf(entry);
      if (i !== -1) registry.splice(i, 1);
    };
  }, [active, registry]);
}

/**
 * While `onBack` is non-null, the hardware back button calls it instead of
 * navigating. Pass `null` when there is nothing local to close.
 */
export function useNativeBackIntercept(onBack: (() => void) | null): void {
  useRegistered(stack, onBack, () => undefined);
}

/**
 * While `guard` is non-null, a back press that would NAVIGATE away (not one
 * an intercept handles, not a minimize, not the offline no-op) calls
 * `guard(leave)` instead; the guard confirms with the user and calls `leave`
 * to go ahead. Used by the standalone door while its outbox holds unsynced
 * writes: a client-side `router.replace` never fires `beforeunload`, so
 * DoorProvider's own leave prompt can't cover it (86ey6bfdm).
 */
export function useNativeLeaveGuard(guard: ((leave: () => void) => void) | null): void {
  useRegistered(leaveGuards, guard, () => undefined);
}
