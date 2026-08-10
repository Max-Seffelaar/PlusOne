'use client';

/**
 * Keeps the door device's screen on for the length of a check-in session
 * (86ey6x56p). Defaults ON where supported — the point is that staff never
 * have to think about it — with a manual off switch surfaced in the door UI
 * for doorhosts who'd rather save battery.
 *
 * The OS releases the lock the instant the tab/app is backgrounded, and never
 * re-delivers it on its own — the visibilitychange listener below re-acquires
 * it every time the door screen comes back to the foreground while the user's
 * intent is still "on" (the spec's "her-acquire bij visibilitychange").
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isWakeLockSupported, releaseWakeLock, requestScreenWakeLock, type WakeLockSentinelLike } from './wakeLock';

export interface WakeLockState {
  /** False in webviews/browsers without the API — callers hide the toggle
   *  entirely rather than show one that would silently do nothing. */
  supported: boolean;
  /** User intent — persists across the OS transiently dropping the lock. */
  enabled: boolean;
  /** Whether a sentinel is actually held right now. */
  active: boolean;
  toggle: () => void;
}

export function useWakeLock(): WakeLockState {
  const supported = isWakeLockSupported();
  const [enabled, setEnabled] = useState(supported);
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const liveRef = useRef(true);

  const onSentinelReleased = useCallback(() => {
    sentinelRef.current = null;
    setActive(false);
  }, []);

  const acquire = useCallback(async () => {
    if (!supported || sentinelRef.current) return;
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
    sentinel.addEventListener('release', onSentinelReleased);
    sentinelRef.current = sentinel;
    setActive(true);
  }, [supported, onSentinelReleased]);

  const release = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    setActive(false);
    if (sentinel) {
      sentinel.removeEventListener('release', onSentinelReleased);
      await releaseWakeLock(sentinel);
    }
  }, [onSentinelReleased]);

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

  useEffect(
    () => () => {
      liveRef.current = false;
      void release();
    },
    [release],
  );

  const toggle = useCallback(() => setEnabled((v) => !v), []);

  return { supported, enabled, active, toggle };
}
