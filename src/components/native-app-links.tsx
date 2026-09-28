'use client';

/**
 * Routes universal links / App Links into the webview (Fase 17 S4). Renders
 * nothing and does nothing in a normal browser: it only registers when
 * `isNativeShell()`, and `@capacitor/app` is imported lazily so the web bundle
 * never loads it. Mounted once, in the root layout, because an auth link can
 * arrive while the webview sits on any route (/login, /app, /door…).
 *
 * The filter is `appLinkTarget` (src/lib/native/app-links.ts): https +
 * app.plus-one.io + exactly /auth/confirm or /auth/callback, else ignored.
 * The target is a same-origin relative path and is loaded as a full document
 * navigation (not router.push): both are route handlers that set the session
 * cookies and redirect, and the handler's own `next=` guard still decides
 * where the user lands.
 *
 * Cold start: Capacitor delivers the launching URL via `getLaunchUrl()`, and
 * that value survives the reload our own navigation causes. Every handled URL
 * is remembered in sessionStorage so the single-use token is never replayed on
 * a remount (→ /login?error=link). If sessionStorage is unavailable the launch
 * URL is skipped rather than risk that loop.
 */
import { useEffect } from 'react';
import { isNativeShell } from '@/lib/platform';
import { appLinkTarget } from '@/lib/native/app-links';

const HANDLED_KEY = 'po.appLinks.handled';

// One navigation per document: iOS can deliver the same cold-start link both
// as a retained `appUrlOpen` event and as `getLaunchUrl()`; two assigns would
// race two requests for one single-use token. Resets with the page, on purpose.
let navigating = false;

type Claim = 'new' | 'seen' | 'unavailable';

// Remember the last link handled in this webview session, so a URL the OS
// hands us again after our own reload (launch URL, retained event) is not
// replayed.
function claim(url: string): Claim {
  try {
    if (window.sessionStorage.getItem(HANDLED_KEY) === url) return 'seen';
    window.sessionStorage.setItem(HANDLED_KEY, url);
    return 'new';
  } catch {
    return 'unavailable';
  }
}

function openAppLink(raw: unknown, source: 'event' | 'launch'): void {
  if (navigating || typeof raw !== 'string') return;
  const target = appLinkTarget(raw);
  if (!target) return;
  const claimed = claim(raw);
  if (claimed === 'seen') return;
  // Without storage the launch URL cannot be de-duplicated across the reload
  // it causes → skip it rather than loop. A live event is delivered once.
  if (claimed === 'unavailable' && source === 'launch') return;
  navigating = true;
  window.location.assign(target);
}

export function NativeAppLinks(): null {
  useEffect(() => {
    if (typeof window === 'undefined' || !isNativeShell()) return;
    let cancelled = false;
    let remove: (() => Promise<void>) | null = null;
    void import('@capacitor/app')
      .then(async ({ App }) => {
        const handle = await App.addListener('appUrlOpen', ({ url }) => openAppLink(url, 'event'));
        if (cancelled) {
          void handle.remove();
          return;
        }
        remove = () => handle.remove();
        const launch = await App.getLaunchUrl().catch(() => undefined);
        if (!cancelled) openAppLink(launch?.url, 'launch');
      })
      .catch(() => {
        // Plugin missing from an older native build: links open the app at its
        // start page (or stay in the browser). Nothing to surface.
      });
    return () => {
      cancelled = true;
      if (remove) void remove().catch(() => undefined);
    };
  }, []);

  return null;
}
