/**
 * Share inbox (share-import S2) — where text shared INTO PlusOne waits until the
 * `/app/share` screen picks it up.
 *
 * Two producers, one consumer:
 *   • the installed PWA's Web Share Target (`public/manifest.json`, method GET):
 *     the OS opens `/app/share?text=…&title=…&url=…`; the service worker answers
 *     that navigation on the device with a 303 to `/app/share#text=…` (no
 *     network, no cache), and without an active worker the query arrives as is.
 *     Either way the screen calls
 *     `captureShareFromLocation()` on mount, which moves the text in here and
 *     rewrites the address bar WITHOUT it (`history.replaceState`);
 *   • the native share plugin (S6, `PlusOneShareInbox`, a later store build)
 *     calls `putSharedText()` and opens `/app/share` with no text in the URL.
 *
 * The shared text is PII (names, e-mails, phone numbers). It lives in module
 * memory only — no storage, no server, no log — until the user presses Add on
 * Paste a list, which goes through the one existing import path, and is
 * cleared once that import succeeds or the user leaves the share screen. A
 * reload of `/app/share` shows an empty list on purpose: module memory does not
 * survive it.
 *
 * Reading is non-destructive (`peekSharedText`) so a remount of the same screen
 * — React StrictMode's double effect in dev — still finds the text; the screen
 * clears it itself on unmount.
 */

/** Query/fragment keys the share target fills (manifest `share_target.params`). */
export const SHARE_PARAMS = ['text', 'title', 'url'] as const;

/** A shared blob larger than this is cut: no guest list is 50k characters, and
 *  the preview re-parses the whole text on every keystroke. */
export const SHARED_TEXT_MAX = 50_000;

let pending: string | null = null;

/** Hand text to the inbox (the native plugin's entry point, S6). Empty or
 *  whitespace-only text is ignored; a newer share replaces an unread one. */
export function putSharedText(text: string): void {
  const v = text.slice(0, SHARED_TEXT_MAX);
  if (v.trim() === '') return;
  pending = v;
}

/** The waiting shared text, or null. Does not clear it — see the header. */
export function peekSharedText(): string | null {
  return pending;
}

/** Forget the shared text (after a successful import, or leaving the screen). */
export function clearSharedText(): void {
  pending = null;
}

/** The guest list inside a share-target payload: `text` is the content; `title`
 *  is a mail subject or a note title, used only when there is no `text`; `url`
 *  is never a guest list. */
export function sharedTextFromParams(params: URLSearchParams): string | null {
  const text = params.get('text') ?? '';
  if (text.trim() !== '') return text;
  const title = params.get('title') ?? '';
  return title.trim() !== '' ? title : null;
}

/** True when a query/fragment carries any share-target key. */
function hasShareParams(params: URLSearchParams): boolean {
  return SHARE_PARAMS.some((k) => params.has(k));
}

/** What `captureShareFromLocation` did. `reloading`: the page is being replaced
 *  by a fresh document (see below); render nothing, that document captures. */
export type ShareCapture = 'none' | 'captured' | 'reloading';

/**
 * Move a share-target payload from the current URL into the inbox and out of
 * the address bar.
 *
 * - **Fragment** (`#text=…`, the normal path): what `public/service-worker.js`
 *   turns the share-target navigation into. It never reached a server. Read it,
 *   then drop it with `replaceState` — fragment only, so the screen does not
 *   remount (the shell keys screens on path + query).
 * - **Query** (the fallback without an active worker): the text already went to
 *   the server once, and Next built this document's router tree with it — its
 *   page segment key is `__PAGE__?{"text":…}`, kept in `history.state` and sent
 *   back as `Next-Router-State-Tree` on the next client navigation. `replaceState`
 *   cannot clean that (Next copies its tree into the new entry), so the page is
 *   REPLACED by `/app/share#text=…`: a fresh document whose tree has no query,
 *   which then takes the fragment path (review S1, 2026-10-09).
 *
 * Every other query key is kept. Guarded for SSR/webviews without
 * `window`/`history`; a no-op when nothing was shared.
 */
export function captureShareFromLocation(
  win: Pick<Window, 'location' | 'history'> | undefined = typeof window === 'undefined' ? undefined : window,
): ShareCapture {
  if (!win) return 'none';
  const url = new URL(win.location.href);
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));

  if (hasShareParams(query)) {
    const fragment = new URLSearchParams();
    for (const k of SHARE_PARAMS) {
      for (const v of query.getAll(k)) fragment.append(k, v);
      query.delete(k);
    }
    const qs = query.toString();
    const path = `${url.pathname}${qs ? `?${qs}` : ''}`;
    try {
      win.location.replace(`${path}#${fragment.toString()}`);
      return 'reloading';
    } catch {
      // A webview that refuses the navigation: capture in place, as before.
      const shared = sharedTextFromParams(fragment);
      if (shared !== null) putSharedText(shared);
      replaceUrl(win, path);
      return 'captured';
    }
  }

  if (!hasShareParams(hash)) return 'none';
  const shared = sharedTextFromParams(hash);
  if (shared !== null) putSharedText(shared);
  replaceUrl(win, `${url.pathname}${url.search}`);
  return 'captured';
}

/**
 * For any page that is NOT the share screen — the login a signed-out share lands
 * on. The service worker's `/app/share#text=…` meets middleware's 307 to
 * `/login?next=/app/share`, and a redirect without its own fragment inherits the
 * request's (Fetch spec), so the list would sit in the login page's URL and
 * browser history. Dropped unread; the text is lost and the user shares again
 * after signing in (the empty share box says so). Review S3, 2026-10-09.
 */
export function dropShareFragment(
  win: Pick<Window, 'location' | 'history'> | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  if (!win) return false;
  const url = new URL(win.location.href);
  if (!hasShareParams(new URLSearchParams(url.hash.replace(/^#/, '')))) return false;
  replaceUrl(win, `${url.pathname}${url.search}`);
  return true;
}

function replaceUrl(win: Pick<Window, 'history'>, path: string): void {
  try {
    // `null`, NOT the current history.state: Next's app router patches
    // replaceState and only syncs its own URL (the one a server action POSTs
    // to) for a state WITHOUT its `__NA` marker. Next copies its internal tree
    // into the new entry itself.
    win.history.replaceState(null, '', path);
  } catch {
    /* a sandboxed webview may refuse — the text is in memory either way */
  }
}
