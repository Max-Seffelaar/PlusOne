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
    expect(safeNextPath('/app/..%2Flogin')).toBe('/app/..%2Flogin'); // encoded — not a literal segment, harmless
    expect(safeNextPath('/../auth/callback')).toBe('/app');
    expect(safeNextPath('/app/events/..')).toBe('/app');
    expect(safeNextPath('/app?next=/../login')).toBe('/app?next=/../login'); // traversal only matters in the path, not the query value
  });

  it('never bounces back to login or auth routes', () => {
    expect(safeNextPath('/login')).toBe('/app');
    expect(safeNextPath('/auth/callback')).toBe('/app');
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

  // safeNextPath only rejects LITERAL `..` segments, so these pass it and the
  // /app prefix test, then normalize out of /app in the browser's URL parser.
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
