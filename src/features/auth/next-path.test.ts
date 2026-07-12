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
