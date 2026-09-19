// Open-redirect guard for the ?next= parameter. Only same-origin, absolute
// in-app paths are allowed; anything pointing off-site falls back. Pure so it
// is unit-tested directly (CLAUDE.md: resource input from the client is
// untrusted).

// The single responsive app surface (po `/app`) is the post-login default for
// every device. The old desktop-only `(app)` routes (e.g. /dashboard) still pass
// through as explicit ?next= targets until they are retired.
const DEFAULT_NEXT = '/app';

export function safeNextPath(raw: string | null | undefined, fallback = DEFAULT_NEXT): string {
  if (!raw) return fallback;
  // Must be a root-relative path, not a protocol-relative ("//evil") or
  // absolute ("https://evil") URL, and must not smuggle a scheme.
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;
  if (raw.includes('://')) return fallback;
  if (raw.includes('\\')) return fallback;
  // Reject dot-segment traversal (e.g. `/app/../login`) — same-origin only, so
  // not an open redirect, but it would otherwise normalize onto a route this
  // guard is specifically meant to deny-list (below).
  const pathOnly = raw.split(/[?#]/)[0];
  if (pathOnly.split('/').includes('..')) return fallback;
  // Never bounce back to the login or auth routes.
  if (raw === '/login' || raw.startsWith('/auth/')) return fallback;
  return raw;
}

// Request header the middleware stamps with the path + query of the request
// being served (deep links through the /app gates). The /app layout sits
// ABOVE `[[...segments]]`, so it receives neither the segments nor searchParams
// — this header is how its consent/MFA gates learn the exact deep link to put
// in `next=`. The middleware always OVERWRITES it, but the matcher skips
// static-extension paths (e.g. /app/x.png), where a client-supplied value
// reaches the layout untouched: treat the value as untrusted input, always.
export const REQUEST_PATH_HEADER = 'x-po-request-path';

// Next's internal RSC cache-busting param. Next 15.5's middleware adapter
// already strips it from `request.nextUrl`; dropped here again so a framework
// change can never leak it into a user-facing `next=`.
const RSC_QUERY = '_rsc';

/** Middleware side: the value to stamp into {@link REQUEST_PATH_HEADER}. */
export function requestPathForHeader(url: URL): string {
  if (!url.searchParams.has(RSC_QUERY)) return url.pathname + url.search;
  const copy = new URL(url.href);
  copy.searchParams.delete(RSC_QUERY);
  return copy.pathname + copy.search;
}

const APP_ROOT = '/app';
// A request URL longer than this is not a deep link worth preserving; bounding
// it keeps an encoded `next=` from pushing the redirect target past URL limits.
const MAX_APP_NEXT_LENGTH = 2048;

/**
 * Layout side: turn the (untrusted) {@link REQUEST_PATH_HEADER} value into the
 * `next=` target for an /app gate. On top of the open-redirect guard it only
 * accepts the /app surface itself — the layout only ever runs for /app/*, so a
 * genuine value always is one, and a forged header can't aim the post-gate
 * redirect at another in-app route. Anything else falls back to bare /app
 * (the pre-fix behaviour).
 */
export function appGateNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > MAX_APP_NEXT_LENGTH) return APP_ROOT;
  const safe = safeNextPath(raw, APP_ROOT);
  const pathOnly = safe.split(/[?#]/)[0];
  if (pathOnly !== APP_ROOT && !pathOnly.startsWith(`${APP_ROOT}/`)) return APP_ROOT;
  return safe;
}
