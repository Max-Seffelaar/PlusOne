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
  let decoded = raw.split(/[?#]/)[0];
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    if (isUnsafePath(decoded)) return fallback;
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return fallback; // malformed escape — never a path we served
    }
    if (next === decoded) return raw; // fixed point, clean at every depth
    decoded = next;
  }
  return fallback; // still unwrapping after MAX_DECODE_ROUNDS — not ours either
}
