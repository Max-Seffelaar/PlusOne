import { describe, it, expect } from 'vitest';
import { appGateNextPath, requestPathForHeader, safeNextPath } from './next-path';

describe('safeNextPath (open-redirect guard)', () => {
  it('passes through safe in-app paths', () => {
    expect(safeNextPath('/app')).toBe('/app');
    expect(safeNextPath('/admin/team?venue=1')).toBe('/admin/team?venue=1');
  });

  it('falls back when empty', () => {
    expect(safeNextPath(null)).toBe('/app');
    expect(safeNextPath(undefined)).toBe('/app');
    expect(safeNextPath('')).toBe('/app');
  });

  it('blocks off-site and protocol-relative targets', () => {
    expect(safeNextPath('//evil.com')).toBe('/app');
    expect(safeNextPath('https://evil.com')).toBe('/app');
    expect(safeNextPath('http://evil.com')).toBe('/app');
    expect(safeNextPath('relative/path')).toBe('/app');
    expect(safeNextPath('/a\\b')).toBe('/app');
  });

  it('blocks dot-segment traversal', () => {
    expect(safeNextPath('/app/../login')).toBe('/app');
    expect(safeNextPath('/../auth/callback')).toBe('/app');
    expect(safeNextPath('/app/events/..')).toBe('/app');
    expect(safeNextPath('/app?next=/../login')).toBe('/app?next=/../login'); // traversal only matters in the path, not the query value
  });

  // A literal-only `..` check is bypassable: the URL parser treats `%2e%2e` as
  // a double-dot segment, and Next's router decodes the pathname before it
  // matches a route, so an encoded slash can split segments too. Same origin
  // throughout — the risk is landing on a deny-listed route, not an open
  // redirect (fresh-session code review of PR #316, 2026-09-23).
  it('blocks percent-encoded dot-segment traversal', () => {
    expect(safeNextPath('/app/%2e%2e/auth/callback')).toBe('/app');
    expect(safeNextPath('/app/%2E%2E/login')).toBe('/app');
    expect(safeNextPath('/app/%2e%2e%2fauth/callback')).toBe('/app');
    expect(safeNextPath('/app/..%2Flogin')).toBe('/app');
    expect(safeNextPath('/app/%2e%2e%5clogin')).toBe('/app'); // encoded backslash
    expect(safeNextPath('/%2e%2e/login')).toBe('/app');
  });

  it('falls back on a malformed percent-escape in the value it was handed', () => {
    expect(safeNextPath('/app/%2')).toBe('/app');
    expect(safeNextPath('/app/%zz')).toBe('/app');
  });

  // An escape that only goes malformed AFTER a round of decoding is a real
  // deep link, not an attack: `%25` is well-formed, and the `%ko` it leaves
  // behind is text the URL parser would not touch either. Rejecting it would
  // silently downgrade the user to bare /app (peer review, #316 session).
  it('keeps a path whose literal % survives decoding', () => {
    expect(safeNextPath('/app/events/50%25korting')).toBe('/app/events/50%25korting');
    expect(appGateNextPath('/app/events/50%25korting')).toBe('/app/events/50%25korting');
    expect(safeNextPath('/app/events/caf%C3%A9')).toBe('/app/events/caf%C3%A9');
  });

  // The same tolerance must not let a deeper `..` hide behind a bad escape:
  // at round 2 this reads `/app/%2e%2e/a%zz`, which `new URL()` normalizes to
  // `/a%zz` — out of /app entirely.
  it('still rejects traversal that surfaces behind a malformed escape', () => {
    expect(safeNextPath('/app/%25252e%25252e/a%2525zz')).toBe('/app');
    expect(appGateNextPath('/app/%25252e%25252e/a%2525zz')).toBe('/app');
  });

  // isUnsafePath runs on the path with query stripped, which is what keeps the
  // strict `://` and `//` rules from hitting a deep link that merely carries an
  // encoded URL as a query VALUE. Moving that split would regress this silently.
  it('does not judge the query as if it were the path', () => {
    expect(safeNextPath('/app/contacts?back=https%3A%2F%2Fevil.example')).toBe(
      '/app/contacts?back=https%3A%2F%2Fevil.example'
    );
    expect(safeNextPath('/app/contacts?path=%2F%2Fevil.example')).toBe(
      '/app/contacts?path=%2F%2Fevil.example'
    );
    // …while an unencoded scheme anywhere in the raw value is still refused.
    expect(safeNextPath('/app/contacts?back=https://evil.example')).toBe('/app');
  });

  // Harmless today — every hop decodes exactly once, so `%252e%252e` never
  // becomes a `..` segment — and rejected anyway, so the guard does not depend
  // on that balance holding for a future consumer that decodes twice.
  it('rejects traversal at any encoding depth', () => {
    expect(safeNextPath('/app/%252e%252e/auth/callback')).toBe('/app');
    expect(safeNextPath('/app/%25252e%25252e/login')).toBe('/app');
    expect(safeNextPath('/%252561uth/callback')).toBe('/app');
  });

  it('gives up on a value still unwrapping past the decode bound', () => {
    // Six levels of encoding on a path that is clean at every depth: nothing
    // this app produces, so the bound rejects rather than keeps unwrapping.
    let deep = '/app/contacts';
    for (let i = 0; i < 6; i += 1) deep = `/${encodeURIComponent(deep.slice(1))}`;
    expect(safeNextPath(deep)).toBe('/app');
  });

  it('never bounces back to login or auth routes', () => {
    expect(safeNextPath('/login')).toBe('/app');
    expect(safeNextPath('/auth/callback')).toBe('/app');
    expect(safeNextPath('/login?next=/app')).toBe('/app'); // query must not defeat the exact match
    expect(safeNextPath('/%61uth/callback')).toBe('/app'); // encoded route name
  });

  it('honours a custom fallback', () => {
    expect(safeNextPath(null, '/settings/profile')).toBe('/settings/profile');
  });
});

describe('requestPathForHeader (middleware stamp for the /app gates)', () => {
  it('keeps the path and query of the request', () => {
    expect(requestPathForHeader(new URL('http://localhost:3000/app/events/abc'))).toBe(
      '/app/events/abc'
    );
    expect(requestPathForHeader(new URL('http://localhost:3000/app?new=event'))).toBe(
      '/app?new=event'
    );
  });

  it("strips Next's internal _rsc param but keeps the rest of the query", () => {
    expect(requestPathForHeader(new URL('http://localhost:3000/app/contacts?_rsc=1x2y'))).toBe(
      '/app/contacts'
    );
    expect(requestPathForHeader(new URL('http://localhost:3000/app?door=e1&_rsc=1x2y'))).toBe(
      '/app?door=e1'
    );
  });

  it('leaves the query encoding untouched when there is no _rsc', () => {
    expect(requestPathForHeader(new URL('http://localhost:3000/app/contacts?q=a%20b&flag'))).toBe(
      '/app/contacts?q=a%20b&flag'
    );
  });

  // Same fidelity on the _rsc branch: the query is edited as text, so nothing
  // is re-serialized (`%20`→`+`, `?flag`→`?flag=`) on RSC requests either.
  it('leaves the rest of the query byte-for-byte when it strips _rsc', () => {
    expect(
      requestPathForHeader(new URL('http://localhost:3000/app/contacts?q=a%20b&flag&_rsc=1x2y'))
    ).toBe('/app/contacts?q=a%20b&flag');
    expect(requestPathForHeader(new URL('http://localhost:3000/app?_rsc=1x2y&q=a%20b'))).toBe(
      '/app?q=a%20b'
    );
  });
});

describe('appGateNextPath (next= for the /app consent/MFA gates)', () => {
  it('passes through /app deep links, query included', () => {
    expect(appGateNextPath('/app')).toBe('/app');
    expect(appGateNextPath('/app/contacts')).toBe('/app/contacts');
    expect(appGateNextPath('/app/events/0190a1b2-c3d4')).toBe('/app/events/0190a1b2-c3d4');
    expect(appGateNextPath('/app?door=e1')).toBe('/app?door=e1');
  });

  it('falls back to /app when the header is missing', () => {
    expect(appGateNextPath(null)).toBe('/app');
    expect(appGateNextPath(undefined)).toBe('/app');
    expect(appGateNextPath('')).toBe('/app');
  });

  it('still applies the open-redirect guard to a forged header', () => {
    expect(appGateNextPath('https://evil.example/app')).toBe('/app');
    expect(appGateNextPath('//evil.example/app')).toBe('/app');
    expect(appGateNextPath('/app\\evil')).toBe('/app');
    expect(appGateNextPath('/app/contacts?back=https://evil.example')).toBe('/app');
    expect(appGateNextPath('/app/../login')).toBe('/app');
  });

  // `safeNextPath` rejects all of these itself now; asserted here too because
  // `appGateNextPath` keeps its own unwrap loop as defense in depth.
  it('rejects percent-encoded traversal out of the /app surface', () => {
    expect(appGateNextPath('/app/%2e%2e/auth/callback')).toBe('/app');
    expect(appGateNextPath('/app/%2E%2E/login')).toBe('/app');
    expect(appGateNextPath('/app/%2e%2e%2fauth/callback')).toBe('/app');
    expect(appGateNextPath('/app/%2')).toBe('/app'); // malformed escape
  });

  // Harmless today (every hop decodes exactly once, so a double-encoded value
  // never becomes a `..` segment), rejected anyway so the guard doesn't depend
  // on that balance holding for a future consumer.
  it('rejects traversal at any encoding depth', () => {
    expect(appGateNextPath('/app/%252e%252e/auth/callback')).toBe('/app');
    expect(appGateNextPath('/app/%25252e%25252e/login')).toBe('/app');
  });

  it('only accepts the /app surface itself', () => {
    expect(appGateNextPath('/admin/team')).toBe('/app');
    expect(appGateNextPath('/mfa/enroll?next=/app')).toBe('/app');
    expect(appGateNextPath('/consent?next=/app')).toBe('/app');
    expect(appGateNextPath('/appx')).toBe('/app');
    expect(appGateNextPath('/application')).toBe('/app');
  });

  it('drops an oversized value instead of carrying it into the redirect', () => {
    expect(appGateNextPath(`/app/contacts?q=${'x'.repeat(4096)}`)).toBe('/app');
  });
});
