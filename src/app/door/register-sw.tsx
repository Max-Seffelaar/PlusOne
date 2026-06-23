'use client';

/** Registers the lean door service worker (app-shell offline). Best-effort. */
import { useEffect } from 'react';

export function RegisterServiceWorker(): null {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // A root-scoped caching SW masks code changes in dev (it served stale /app
    // chunks across the whole origin). The offline shell is a production-only
    // enhancement: never register it in dev, and clean up any leftover registration.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations?.()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => undefined);
      return;
    }
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      /* offline-shell is an enhancement; failure must not break the door */
    });
  }, []);
  return null;
}
