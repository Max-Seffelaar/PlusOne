'use client';

/**
 * Keeps the door device's screen on for the length of a check-in session
 * (86ey6x56p). Defaults ON where supported — the point is that staff never
 * have to think about it — with a manual off switch surfaced in the door UI
 * for doorhosts who'd rather save battery; that choice is persisted per
 * device so it survives a reload instead of silently resetting to on.
 *
 * The OS releases the lock the instant the tab/app is backgrounded, and never
 * re-delivers it on its own — the visibilitychange listener below re-acquires
 * it every time the door screen comes back to the foreground while the user's
 * intent is still "on" (the spec's "her-acquire bij visibilitychange"). The
 * browser can ALSO revoke a lock while the document stays visible (battery
 * saver is the documented case) — that path is handled separately, by
 * re-acquiring on the sentinel's own `release` event.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isWakeLockSupported,
  readWakeLockOffPreference,
  releaseWakeLock,
  requestScreenWakeLock,
  writeWakeLockOffPreference,
  type WakeLockSentinelLike,
} from './wakeLock';

export interface WakeLockState {
  /** False in webviews/browsers without the API, AND for the very first
   *  client render even when the API exists (see below) — callers hide the
   *  toggle entirely rather than show one that would silently do nothing. */
  supported: boolean;
  /** User intent — persists across the OS transiently dropping the lock. */
  enabled: boolean;
  /** Whether a sentinel is actually held right now. `enabled && !active`
   *  means "trying to hold it but currently can't" (refused, or the browser
   *  just revoked it and a re-acquire is pending) — callers must render that
   *  distinctly from a solid lock, never claim protection they don't have. */
  active: boolean;
  toggle: () => void;
}

export function useWakeLock(): WakeLockState {
  // `supported` starts false on EVERY first render (server and client alike)
  // and is only upgraded in the mount effect below. Computing it eagerly
  // during render (`isWakeLockSupported()` called inline) reads differently
  // on the server (Node's `navigator` has no `wakeLock`) than on a real
  // browser's very first client render — an immediate hydration mismatch on
  // every SSR'd door load, not something that "usually" happens to agree like
  // `navigator.onLine` does elsewhere in this codebase. Starting pessimistic
  // and upgrading post-hydration avoids that entirely.
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const liveRef = useRef(true);
  // `onSentinelReleased` needs to call `acquire`, and `acquire` needs to pass
  // `onSentinelReleased` to `sentinel.addEventListener` — broken via a ref so
  // neither has to depend on the other's identity.
  const acquireRef = useRef<() => Promise<void>>();

  const onSentinelReleased = useCallback(() => {
    sentinelRef.current = null;
    setActive(false);
    // The browser can revoke a held lock while the document is still visible
    // (battery-saver policies are the documented MDN case) — that is NOT the
    // visibilitychange path below, so retry once here. If the browser refuses
    // again, `acquire()` just leaves `active` false; nothing loops, since a
    // refused request never attaches a NEW release listener to retry from.
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && enabledRef.current) {
      void acquireRef.current?.();
    }
  }, []);

  const acquire = useCallback(async () => {
    if (!supported) return;
    const current = sentinelRef.current;
    if (current) {
      if (!current.released) return; // already held
      sentinelRef.current = null; // dead ref (e.g. iOS pre-18.4 dropped the release event) — clear and retry
    }
    const sentinel = await requestScreenWakeLock();
    if (!sentinel) {
      setActive(false);
      return;
    }
    // Intent may have flipped off (or the hook unmounted) while the request
    // was in flight — release immediately rather than surprise-relock the
    // screen a beat after the doorhost turned the toggle off.
    if (!enabledRef.current || !liveRef.current) {
      void releaseWakeLock(sentinel);
      return;
    }
    // A concurrent acquire (e.g. a rapid resume + release-retry race) may
    // have already landed a sentinel while this one was in flight — release
    // the newly obtained one rather than orphaning it or clobbering the ref.
    if (sentinelRef.current && !sentinelRef.current.released) {
      void releaseWakeLock(sentinel);
      return;
    }
    sentinel.addEventListener('release', onSentinelReleased);
    sentinelRef.current = sentinel;
    setActive(true);
  }, [supported, onSentinelReleased]);
  acquireRef.current = acquire;

  const release = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setActive(false);
    if (sentinel) {
      sentinel.removeEventListener('release', onSentinelReleased);
      await releaseWakeLock(sentinel);
    }
  }, [onSentinelReleased]);

  // Upgrade `supported`/`enabled` post-hydration (client-only). Reads the
  // persisted off-preference so an explicit OFF survives a reload instead of
  // resetting to the ON default every time.
  useEffect(() => {
    const actuallySupported = isWakeLockSupported();
    setSupported(actuallySupported);
    if (actuallySupported) setEnabled(!readWakeLockOffPreference());
  }, []);

  useEffect(() => {
    if (enabled) void acquire();
    else void release();
  }, [enabled, acquire, release]);

  useEffect(() => {
    if (!supported) return;
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible' && enabledRef.current) void acquire();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [supported, acquire]);

  useEffect(() => {
    // Reset explicitly on every mount (not just relying on the `useRef(true)`
    // initializer) — if StrictMode's dev-only double-invoke of effects is
    // ever re-enabled (next.config.ts currently disables it "temporarily"),
    // its simulated unmount would otherwise leave this permanently `false`
    // after the simulated remount, silently killing every future acquire.
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      void release();
    };
  }, [release]);

  const toggle = useCallback(() => {
    setEnabled((v) => {
      const next = !v;
      writeWakeLockOffPreference(!next);
      return next;
    });
  }, []);

  return { supported, enabled, active, toggle };
}
