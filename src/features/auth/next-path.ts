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
