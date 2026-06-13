import { describe, it, expect } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath (open-redirect guard)', () => {
  it('passes through safe in-app paths', () => {
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
    expect(safeNextPath('/admin/team?venue=1')).toBe('/admin/team?venue=1');
  });

  it('falls back when empty', () => {
    expect(safeNextPath(null)).toBe('/dashboard');
    expect(safeNextPath(undefined)).toBe('/dashboard');
    expect(safeNextPath('')).toBe('/dashboard');
  });

  it('blocks off-site and protocol-relative targets', () => {
    expect(safeNextPath('//evil.com')).toBe('/dashboard');
    expect(safeNextPath('https://evil.com')).toBe('/dashboard');
    expect(safeNextPath('http://evil.com')).toBe('/dashboard');
    expect(safeNextPath('relative/path')).toBe('/dashboard');
    expect(safeNextPath('/a\\b')).toBe('/dashboard');
  });

  it('never bounces back to login or auth routes', () => {
    expect(safeNextPath('/login')).toBe('/dashboard');
    expect(safeNextPath('/auth/callback')).toBe('/dashboard');
  });

  it('honours a custom fallback', () => {
    expect(safeNextPath(null, '/settings/profile')).toBe('/settings/profile');
  });
});
