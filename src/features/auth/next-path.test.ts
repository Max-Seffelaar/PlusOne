import { describe, it, expect } from 'vitest';
import { safeNextPath } from './next-path';

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

  it('falls back on a malformed percent-escape', () => {
    expect(safeNextPath('/app/%2')).toBe('/app');
    expect(safeNextPath('/app/%zz')).toBe('/app');
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
