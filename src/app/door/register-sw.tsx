'use client';

/** Registers the lean door service worker (app-shell offline). Best-effort. */
import { useEffect } from 'react';

/** Paths whose HTML the persistent shell needs but the SW would otherwise never
 *  see. Every in-app move is a `<Link>`/RSC fetch (`mode: 'cors'`), not a
 *  document navigation, so arriving at `/door/<eventId>` from the picker never
 *  produces a 'navigate' request the SW can cache — a first-session tablet would
 *  have nothing to boot from offline. `/` is the installed PWA's manifest
 *  `start_url`, so it needs the same treatment for an offline home-screen
 *  launch. The SW re-validates every path against its own SHELL rules before
 *  fetching, so this list cannot widen what gets persisted (86ey9e9mn). */
function shellPathsToSeed(pathname: string): string[] {
  const paths = ['/'];
  if (/^\/door\/[^/]+$/.test(pathname)) paths.push(pathname);
  return paths;
}

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
    navigator.serviceWorker
      .register('/service-worker.js')
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        const worker = registration.active ?? navigator.serviceWorker.controller;
        worker?.postMessage({
          type: 'seed-shell',
          paths: shellPathsToSeed(window.location.pathname),
        });
      })
      .catch(() => {
        /* offline-shell is an enhancement; failure must not break the door */
      });
  }, []);
  return null;
}
