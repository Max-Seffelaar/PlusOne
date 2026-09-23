// Open-redirect guard for the ?next= parameter. Only same-origin, absolute
// in-app paths are allowed; anything pointing off-site falls back. Pure so it
// is unit-tested directly (CLAUDE.md: resource input from the client is
// untrusted).

// The single responsive app surface (po `/app`) is the post-login default for
// every device. The old desktop-only `(app)` routes (e.g. /dashboard) still pass
// through as explicit ?next= targets until they are retired.
const DEFAULT_NEXT = '/app';

// Encoding depths unwrapped before a value is rejected outright. Nothing this
// app produces is encoded even twice; the bound exists so a hostile value can
// never drive an unbounded loop.
const MAX_DECODE_ROUNDS = 5;

/**
 * Percent-decode one level the way a URL parser does: each maximal run of
 * `%XX` escapes is decoded together (so multi-byte UTF-8 like `caf%C3%A9`
 * survives), and a run that will not decode is left as literal text instead of
 * throwing away the whole value.
 *
 * Tolerance matters from the second round on. `/app/events/50%25korting` is a
 * perfectly good deep link: round one turns it into `/app/events/50%korting`,
 * where `%ko` is not an escape at all. A throwing decode would reject it and
 * silently downgrade the user to bare /app — the exact feature #316 shipped.
 * It costs no safety: a run the decoder cannot resolve is one the WHATWG URL
 * parser leaves alone too, so it can never become a separator or a dot segment
 * downstream (peer review from the #316 session, 2026-09-23).
 */
function decodePathOnce(path: string): string {
  return path.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run; // valid escape syntax, invalid UTF-8 — leave it as written
    }
  });
}

/**
 * Every structural rule a `next=` path must satisfy, applied at one encoding
 * depth: no protocol-relative prefix, no smuggled scheme, no backslash, no
 * `..` segment, and not a route the redirect must never land on.
 */
function isUnsafePath(path: string): boolean {
  return (
    path.startsWith('//') ||
    path.includes('://') ||
    path.includes('\\') ||
    path.split('/').includes('..') ||
    isDeniedRoute(path)
  );
}

/**
 * The routes a post-login redirect must never land on: bouncing back to the
 * login/auth flow either loops or re-enters a flow the user just completed.
 * Checked against the path only (query stripped) so `/login?x=1` cannot slip
 * past an exact-match comparison.
 */
function isDeniedRoute(pathOnly: string): boolean {
  return pathOnly === '/login' || pathOnly.startsWith('/auth/');
}

export function safeNextPath(raw: string | null | undefined, fallback = DEFAULT_NEXT): string {
  if (!raw) return fallback;
  // Must be a root-relative path, not a protocol-relative ("//evil") or
  // absolute ("https://evil") URL, and must not smuggle a scheme.
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;
  if (raw.includes('://')) return fallback;
  if (raw.includes('\\')) return fallback;

  // The checks above are not enough on their own: a literal-only `..` test is
  // bypassable, because `/app/%2e%2e/auth/callback` has no literal `..` segment
  // yet the URL parser normalizes it to `/auth/callback` — same origin, but
  // exactly the route the deny-list exists to block (fresh-session code review
  // of PR #316, 2026-09-23). So the path is re-checked at every encoding depth
  // down to a FIXED POINT, not just once. One decode would model what the URL
  // parser does today, but the guard must not depend on every consumer decoding
  // exactly once: a future hop that decodes twice would reopen the hole
  // (security review of PR #316, same day).
  //
  // Decoding also turns `%2f` into a real separator, so `/app/%2e%2e%2fauth/…`
  // and `/app/..%2Flogin` are rejected too. That is stricter than the URL parser
  // alone (it does not split on `%2f`), deliberately: Next's router decodes the
  // pathname before it matches routes, so an encoded slash can still change
  // which route runs. A `next=` target with a genuine encoded `..` or `/` in a
  // segment is not a thing this app produces.
  const pathOnly = raw.split(/[?#]/)[0];
  // A malformed escape in the value we were HANDED (`/app/%2`) is never a path
  // we served, so it is rejected outright. Escapes that only go malformed after
  // a round of decoding are a different case — see decodePathOnce.
  try {
    decodeURIComponent(pathOnly);
  } catch {
    return fallback;
  }

  let decoded = pathOnly;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    if (isUnsafePath(decoded)) return fallback;
    const next = decodePathOnce(decoded);
    if (next === decoded) return raw; // fixed point, clean at every depth
    decoded = next;
  }
  return fallback; // still unwrapping after MAX_DECODE_ROUNDS — not ours either
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

/**
 * Middleware side: the value to stamp into {@link REQUEST_PATH_HEADER}.
 *
 * The query is edited as TEXT, not through `URLSearchParams`: re-serializing
 * rewrites the whole query (`%20`→`+`, a bare `?flag`→`?flag=`), so the deep
 * link that reaches `next=` would not be byte-for-byte the one the user opened
 * — and only on requests that happen to carry `_rsc` (both reviews, 23/9).
 */
export function requestPathForHeader(url: URL): string {
  if (!url.searchParams.has(RSC_QUERY)) return url.pathname + url.search;
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((pair) => pair !== RSC_QUERY && !pair.startsWith(`${RSC_QUERY}=`));
  return kept.length > 0 ? `${url.pathname}?${kept.join('&')}` : url.pathname;
}

const APP_ROOT = '/app';
// Longest raw value accepted. A deep link past this isn't worth preserving, and
// `encodeURIComponent` roughly triples the worst case, so the bound on the raw
// value is what keeps the encoded `next=` inside sane URL limits.
const MAX_APP_NEXT_LENGTH = 2048;

/**
 * Layout side: turn the (untrusted) {@link REQUEST_PATH_HEADER} value into the
 * `next=` target for an /app gate. On top of the open-redirect guard it only
 * accepts the /app surface itself — the layout only ever runs for /app/*, so a
 * genuine value always is one, and a forged header can't aim the post-gate
 * redirect at another in-app route. Anything else falls back to bare /app
 * (the pre-fix behaviour).
 *
 * The unwrap loop below is deliberate defense in depth, not a live gap.
 * `safeNextPath` now runs the same fixed-point decode for every `?next=`
 * consumer, so nothing reaches this loop today. It stays because the prefix
 * test above runs on the ENCODED path, which is only safe while the shared
 * guard keeps treating `%2e%2e` as traversal and `%2f` as a separator — the
 * strictest part of that guard, and the part most likely to be relaxed for some
 * future deep link. Keeping the check local means relaxing it there cannot
 * silently open the /app gates (code review + security review, 2026-09-23).
 */
export function appGateNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > MAX_APP_NEXT_LENGTH) return APP_ROOT;
  const safe = safeNextPath(raw, APP_ROOT);
  const pathOnly = safe.split(/[?#]/)[0];
  if (pathOnly !== APP_ROOT && !pathOnly.startsWith(`${APP_ROOT}/`)) return APP_ROOT;
  // Same fixed-point unwrap the shared guard does, kept local per the docblock,
  // and tolerant for the same reason: `/app/events/50%25korting` must survive.
  let decoded = pathOnly;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    if (decoded.split('/').includes('..')) return APP_ROOT;
    const next = decodePathOnce(decoded);
    if (next === decoded) return safe; // fixed point, no traversal at any depth
    decoded = next;
  }
  return APP_ROOT; // still unwrapping after MAX_DECODE_ROUNDS — not a path we served
}
