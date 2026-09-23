// Open-redirect guard for the ?next= parameter. Only same-origin, absolute
// in-app paths are allowed; anything pointing off-site falls back. Pure so it
// is unit-tested directly (CLAUDE.md: resource input from the client is
// untrusted).

// The single responsive app surface (po `/app`) is the post-login default for
// every device. The old desktop-only `(app)` routes (e.g. /dashboard) still pass
// through as explicit ?next= targets until they are retired.
const DEFAULT_NEXT = '/app';

/**
 * Percent-decode a path exactly once, mirroring what a URL parser (and Next's
 * router) does before it looks at segments. One level only: the WHATWG URL
 * parser treats `%2e%2e` as a double-dot segment but leaves `%252e%252e` as
 * literal text, so decoding twice would reject paths that never normalize.
 *
 * Returns null for a malformed escape (e.g. `/app/%2`), which is never a path
 * we served and is therefore treated as hostile.
 */
function decodePathOnce(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/**
 * True when `path` contains a `..` segment. Called on both the raw and the
 * decoded path so percent-encoded traversal is caught too.
 */
function hasTraversalSegment(path: string): boolean {
  return path.split('/').includes('..');
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

  const pathOnly = raw.split(/[?#]/)[0];
  // Every structural check below runs on the decoded path as well as the raw
  // one. A literal-only check is bypassable: `/app/%2e%2e/auth/callback` has no
  // literal `..` segment, but the URL parser normalizes it to `/auth/callback`
  // — same origin, yet exactly the route the deny-list exists to block
  // (fresh-session code review of PR #316, 2026-09-23). Decoding also turns
  // `%2f` into a real separator, so `/app/%2e%2e%2fauth/callback` and
  // `/app/..%2Flogin` are rejected too. That is stricter than the URL parser
  // alone (it does not split on `%2f`), deliberately: Next's router decodes the
  // pathname before it matches routes, so an encoded slash can still change
  // which route runs. A `next=` target with a genuine encoded `..` or `/` in a
  // segment is not a thing this app produces.
  const decodedPath = decodePathOnce(pathOnly);
  if (decodedPath === null) return fallback;
  if (decodedPath.startsWith('//')) return fallback;
  if (decodedPath.includes('://')) return fallback;
  if (decodedPath.includes('\\')) return fallback;
  if (hasTraversalSegment(pathOnly) || hasTraversalSegment(decodedPath)) return fallback;
  // Never bounce back to the login or auth routes — again on both forms, so
  // `/%61uth/callback` cannot reach a route `/auth/callback` is denied.
  if (isDeniedRoute(pathOnly) || isDeniedRoute(decodedPath)) return fallback;
  return raw;
}
