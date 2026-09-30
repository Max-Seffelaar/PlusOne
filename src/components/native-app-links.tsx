'use client';

/**
 * Routes universal links / App Links into the webview (Fase 17 S4). Renders
 * nothing and does nothing in a normal browser (listener lifecycle:
 * `useCapacitorApp`). Mounted once, in the root layout, because an auth link
 * can arrive while the webview sits on any route (/login, /app, /door…).
 *
 * The filter is `appLinkTarget` (src/lib/native/app-links.ts): https +
 * app.plus-one.io + exactly /auth/confirm or /auth/callback, else ignored.
 * The target is a same-origin relative path and is loaded as a full document
 * navigation (not router.push): both are route handlers that set the session
 * cookies and redirect, and the handler's own `next=` guard still decides
 * where the user lands.
 *
 * De-dup contract: a given link is navigated AT MOST ONCE per app process
 * (= webview session = sessionStorage lifetime), from either source, and it
 * only counts as used once that navigation actually commits. Why each part:
 *
 *  - Android's `App.getLaunchUrl()` is sticky: `Bridge.java` reads the intent
 *    data once, so it keeps returning the COLD-START link for the whole process,
 *    after every later link and every reload. A single "last handled" slot is
 *    overwritten by the next link and the cold-start token gets replayed. So
 *    every committed link is remembered in a set.
 *  - iOS can deliver the cold-start link twice in one document (retained
 *    `appUrlOpen` + `getLaunchUrl()`): one navigation per document (`inFlight`).
 *  - A navigation that never leaves (iOS keeps the page on a failed provisional
 *    navigation) must not strand a valid, never-presented token: the link is
 *    recorded on `pagehide` (the commit), and `inFlight` is released if the
 *    document is still alive after COMMIT_TIMEOUT_MS. A known-offline tap is
 *    not attempted at all; it is retried on the `online` event.
 *  - `pagehide` is the primary commit signal; a `pending` marker written just
 *    before the navigation is promoted on the next document's mount, so a
 *    webview that skips `pagehide` still cannot loop on the sticky launch URL.
 *
 * Storage holds only a short hash of each link, never the URL: the raw link
 * carries the token_hash. It is deliberately NOT wiped on sign-out — on Android
 * that would re-arm the sticky launch URL and replay a used token on /login.
 * If sessionStorage is unavailable the launch URL is skipped rather than risk
 * a replay loop; a live event (fresh user intent) is still honoured.
 */
import { appLinkTarget } from '@/lib/native/app-links';
import { useCapacitorApp } from '@/lib/native/use-capacitor-app';

const CONSUMED_KEY = 'po.appLinks.consumed';
const PENDING_KEY = 'po.appLinks.pending';
/** A committed navigation unloads the page well within this; if we are still here, it failed. */
export const COMMIT_TIMEOUT_MS = 10_000;
/** Bound on remembered links per process; the oldest drops first. */
const MAX_REMEMBERED = 50;

type Source = 'event' | 'launch';

// Per document (resets with the page, on purpose).
let inFlight: string | null = null;
let pendingPromoted = false;
let deferred: { raw: string; source: Source } | null = null;
let onlineListener = false;

/** cyrb53: a fast, stable 53-bit string hash. De-dup key only — not a security control. */
function linkKey(url: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The committed link keys, or null when sessionStorage is unavailable. */
function readConsumed(): string[] | null {
  try {
    const raw = window.sessionStorage.getItem(CONSUMED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return null;
  }
}

function markConsumed(key: string): void {
  try {
    const keys = (readConsumed() ?? []).filter((k) => k !== key);
    keys.push(key);
    window.sessionStorage.setItem(CONSUMED_KEY, JSON.stringify(keys.slice(-MAX_REMEMBERED)));
  } catch {
    // Storage gone mid-session: nothing to remember into.
  }
}

function setPending(key: string | null): void {
  try {
    if (key) window.sessionStorage.setItem(PENDING_KEY, key);
    else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // See markConsumed.
  }
}

/** A pending marker that survived into a new document means the navigation committed. */
function promotePending(): void {
  if (pendingPromoted) return;
  pendingPromoted = true;
  try {
    const key = window.sessionStorage.getItem(PENDING_KEY);
    if (key) markConsumed(key);
  } catch {
    // Unavailable storage: nothing pending.
  }
  setPending(null);
}

function retryDeferred(): void {
  const next = deferred;
  deferred = null;
  if (next) openAppLink(next.raw, next.source);
}

function openAppLink(raw: unknown, source: Source): void {
  if (inFlight !== null || typeof raw !== 'string') return;
  const target = appLinkTarget(raw);
  if (!target) return;
  const key = linkKey(raw);
  const consumed = readConsumed();
  // Without storage the sticky launch URL cannot be de-duplicated across the
  // reload it causes → skip it rather than loop. A live event is fresh intent.
  if (consumed === null && source === 'launch') return;
  if (consumed?.includes(key)) return;

  // Known offline: the request would never reach the server. Keep the link
  // unused and try again once the device is back online.
  if (navigator.onLine === false) {
    deferred = { raw, source };
    if (!onlineListener) {
      onlineListener = true;
      window.addEventListener('online', retryDeferred);
    }
    return;
  }

  inFlight = key;
  const onCommit = (): void => {
    window.clearTimeout(timer);
    markConsumed(key);
    setPending(null);
  };
  const timer = window.setTimeout(() => {
    // Still on this page: the navigation failed before it committed, so the
    // token never reached the server. Release it for a retry.
    window.removeEventListener('pagehide', onCommit);
    if (inFlight === key) inFlight = null;
    setPending(null);
  }, COMMIT_TIMEOUT_MS);
  window.addEventListener('pagehide', onCommit, { once: true });
  setPending(key);
  window.location.assign(target);
}

export function NativeAppLinks(): null {
  useCapacitorApp(async (App, isActive) => {
    promotePending();
    const handle = await App.addListener('appUrlOpen', ({ url }) => openAppLink(url, 'event'));
    if (isActive()) {
      const launch = await App.getLaunchUrl().catch(() => undefined);
      if (isActive()) openAppLink(launch?.url, 'launch');
    }
    return handle;
  }, []);

  return null;
}
