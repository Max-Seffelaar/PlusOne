'use client';

/**
 * Registers the offline-shell service worker (`public/service-worker.js`) and
 * seeds what it cannot see on its own. Best-effort: the app never DEPENDS on the
 * worker (Capacitor checklist, #37) — it only buys an offline cold start.
 *
 * Mounted by both `/door` (src/app/door/layout.tsx) and `/app`
 * (src/app/app/layout.tsx). The `/app` mount is N7 (decision 15): the native
 * shell always cold-starts at the origin → `/app`, so the Deur tab there is the
 * offline surface, and a user who only ever opens `/app` must still get the
 * worker on their first online visit.
 */
import { useEffect } from 'react';

/** Paths whose HTML the persistent shell needs but the SW would otherwise never
 *  see. Every in-app move is a `<Link>`/RSC fetch (`mode: 'cors'`), not a
 *  document navigation, so arriving at `/door/<eventId>` from the picker never
 *  produces a 'navigate' request the SW can cache — a first-session tablet would
 *  have nothing to boot from offline. `/` is the installed PWA's manifest
 *  `start_url`, so it needs the same treatment for an offline home-screen
 *  launch. The SW re-validates every path against its own SHELL rules before
 *  fetching, so this list cannot widen what gets persisted (86ey9e9mn). */
export function shellPathsToSeed(pathname: string): string[] {
  const paths = ['/'];
  if (/^\/door\/[^/]+$/.test(pathname)) paths.push(pathname);
  return paths;
}

/** True on the `/app` surface — the only place `/app` is seeded (session bucket). */
export function isAppSurface(pathname: string): boolean {
  return pathname === '/app' || pathname.startsWith('/app/');
}

/**
 * Same-origin build chunks this page has already loaded. The first visit is not
 * controlled by the worker (it registers after load), so these never went
 * through its static handler; posting them lets it cache them (N7). The SW
 * re-checks each URL (same-origin `/_next/static/` only) — this filter just
 * keeps the message small.
 */
export function loadedAssetUrls(): string[] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];
  const origin = window.location.origin;
  const found = new Set<string>();
  const consider = (raw: string | null | undefined): void => {
    if (!raw) return;
    try {
      const url = new URL(raw, origin);
      if (url.origin === origin && url.pathname.startsWith('/_next/static/')) found.add(url.href);
    } catch {
      // not a URL — ignore
    }
  };
  try {
    for (const entry of performance.getEntriesByType('resource')) consider(entry.name);
  } catch {
    // Performance timeline unavailable in some webviews — the DOM scan below still covers the entry chunks.
  }
  document.querySelectorAll('script[src]').forEach((el) => consider(el.getAttribute('src')));
  document.querySelectorAll('link[rel="stylesheet"][href], link[rel="preload"][href]').forEach((el) =>
    consider(el.getAttribute('href')),
  );
  return [...found];
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active ?? navigator.serviceWorker.controller ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask the worker to cache every build chunk loaded so far. Called once the
 * worker is ready, and again by the Deur tab after its lazy chunk has loaded
 * (the door is the one screen that has to boot offline).
 */
export async function seedLoadedAssets(): Promise<void> {
  const worker = await activeWorker();
  const urls = loadedAssetUrls();
  if (worker && urls.length) worker.postMessage({ type: 'seed-assets', urls });
}

/** Seed `/app` into the SESSION bucket unless a copy is already there. A real
 *  `/app` navigation refreshes that entry anyway (network-first); this only
 *  covers the first visit, which happened before the worker existed. */
async function seedAppSession(worker: ServiceWorker): Promise<void> {
  try {
    if (typeof caches !== 'undefined' && (await caches.match('/app', { ignoreSearch: true }))) return;
  } catch {
    // CacheStorage unavailable from the page — let the worker decide.
  }
  worker.postMessage({ type: 'seed-session', paths: ['/app'] });
}

/**
 * Opt-in for the local e2e spec only (N7): a dev build normally never runs the
 * worker (it masked code changes), so the offline-reload spec sets this key
 * before loading the page. Production ignores it.
 */
export const DEV_SW_OPT_IN_KEY = 'po:sw-dev-cache';

function devOptIn(): boolean {
  try {
    return window.localStorage.getItem(DEV_SW_OPT_IN_KEY) === '1';
  } catch {
    return false;
  }
}

export function RegisterServiceWorker(): null {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let scriptUrl = '/service-worker.js';
    // A root-scoped caching SW masks code changes in dev (it served stale /app
    // chunks across the whole origin). The offline shell is a production-only
    // enhancement: never register it in dev, and clean up any leftover
    // registration — unless the e2e spec opted in explicitly.
    if (process.env.NODE_ENV !== 'production') {
      if (!devOptIn()) {
        navigator.serviceWorker
          .getRegistrations?.()
          .then((regs) => regs.forEach((r) => r.unregister()))
          .catch(() => undefined);
        return;
      }
      scriptUrl = '/service-worker.js?dev-cache=1';
    }
    const pathname = window.location.pathname;
    navigator.serviceWorker
      .register(scriptUrl)
      .then(() => navigator.serviceWorker.ready)
      .then(async (registration) => {
        const worker = registration.active ?? navigator.serviceWorker.controller;
        if (!worker) return;
        worker.postMessage({ type: 'seed-shell', paths: shellPathsToSeed(pathname) });
        if (isAppSurface(pathname)) await seedAppSession(worker);
        await seedLoadedAssets();
      })
      .catch(() => {
        /* offline-shell is an enhancement; failure must not break the app or the door */
      });
  }, []);
  return null;
}
