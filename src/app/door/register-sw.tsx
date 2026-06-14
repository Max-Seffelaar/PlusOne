'use client';

/** Registers the lean door service worker (app-shell offline). Best-effort. */
import { useEffect } from 'react';

export function RegisterServiceWorker(): null {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      /* offline-shell is an enhancement; failure must not break the door */
    });
  }, []);
  return null;
}
