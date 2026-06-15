import { describe, it, expect } from 'vitest';
import { isEffectivelyLocked } from './lock';

const NOW = new Date('2026-06-21T02:30:00Z');

describe('isEffectivelyLocked (mirrors can_write_guests)', () => {
  it('is locked when manually locked, regardless of auto-lock', () => {
    expect(isEffectivelyLocked(true, null, NOW)).toBe(true);
    expect(isEffectivelyLocked(true, '2099-01-01T00:00:00Z', NOW)).toBe(true);
  });

  it('is open when not locked and no auto-lock set', () => {
    expect(isEffectivelyLocked(false, null, NOW)).toBe(false);
  });

  it('locks once the auto-lock instant has passed', () => {
    expect(isEffectivelyLocked(false, '2026-06-21T02:00:00Z', NOW)).toBe(true); // 30m ago
    expect(isEffectivelyLocked(false, '2026-06-21T02:30:00Z', NOW)).toBe(true); // exactly now
  });

  it('stays open before the auto-lock instant', () => {
    expect(isEffectivelyLocked(false, '2026-06-21T03:00:00Z', NOW)).toBe(false); // 30m ahead
  });

  it('treats an unparseable auto-lock value as not set', () => {
    expect(isEffectivelyLocked(false, 'not-a-date', NOW)).toBe(false);
  });
});
