/**
 * Share inbox (share-import S2) — where text shared INTO PlusOne waits until the
 * `/app/share` screen picks it up.
 *
 * Two producers, one consumer:
 *   • the installed PWA's Web Share Target (`public/manifest.json`, method GET):
 *     the OS opens `/app/share?text=…&title=…&url=…`; the screen calls
 *     `captureShareFromLocation()` on mount, which moves the text in here and
 *     rewrites the address bar WITHOUT it (`history.replaceState`);
 *   • the native share plugin (S6, `PlusOneShareInbox`, a later store build)
 *     calls `putSharedText()` and opens `/app/share` with no text in the URL.
 *
 * The shared text is PII (names, e-mails, phone numbers). It lives in module
 * memory only — no storage, no server, no log — until the user presses Add on
 * Paste a list, which goes through the one existing import path, and is
 * cleared once that import succeeds. A reload of `/app/share` shows an empty
 * list on purpose: module memory does not survive it.
 *
 * Reading is non-destructive on purpose. The shell keys its screen on the full
 * URL (the entrance animation), so rewriting the URL remounts the share screen;
 * a read-once inbox would hand the text to the first mount and nothing to the
 * one that stays.
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

/** Forget the shared text (after a successful import). */
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

/**
 * Move a share-target payload from the current URL into the inbox and strip it
 * from the address bar. Reads the query (what a GET share target produces) and
 * the fragment (`#text=…`, which never reaches a server — the shape a future
 * service-worker hop would hand over). Every other query key is kept. Guarded
 * for SSR/webviews without `window`/`history`; a no-op when nothing was shared.
 */
export function captureShareFromLocation(win: Pick<Window, 'location' | 'history'> | undefined = typeof window === 'undefined' ? undefined : window): void {
  if (!win) return;
  const url = new URL(win.location.href);
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const fromQuery = hasShareParams(query);
  const fromHash = hasShareParams(hash);
  if (!fromQuery && !fromHash) return;

  const shared = (fromQuery ? sharedTextFromParams(query) : null) ?? (fromHash ? sharedTextFromParams(hash) : null);
  if (shared !== null) putSharedText(shared);

  for (const k of SHARE_PARAMS) query.delete(k);
  const qs = query.toString();
  const clean = `${url.pathname}${qs ? `?${qs}` : ''}`;
  try {
    // `null`, NOT the current history.state: Next's app router patches
    // replaceState and only syncs its own URL (the one a server action POSTs
    // to) for a state WITHOUT its `__NA` marker. Handing its state back would
    // clean the address bar but leave the router — and the import's POST URL —
    // on `?text=…`. Next copies its internal tree into the new entry itself.
    win.history.replaceState(null, '', clean);
  } catch {
    /* a sandboxed webview may refuse — the text is in memory either way */
  }
}
