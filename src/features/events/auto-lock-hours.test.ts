import { describe, it, expect } from 'vitest';
import { parseAutoLockOffsetMinutes } from './auto-lock-hours';

describe('parseAutoLockOffsetMinutes', () => {
  it('returns null for an empty field (no auto-lock)', () => {
    expect(parseAutoLockOffsetMinutes('')).toBeNull();
    expect(parseAutoLockOffsetMinutes('   ')).toBeNull();
  });

  it('accepts a plain integer', () => {
    expect(parseAutoLockOffsetMinutes('2')).toBe(-120);
  });

  it('normalizes a Dutch-decimal comma instead of producing NaN (C23)', () => {
    expect(parseAutoLockOffsetMinutes('1,5')).toBe(-90);
    expect(parseAutoLockOffsetMinutes('0,5')).toBe(-30);
  });

  it('accepts a dot decimal too', () => {
    expect(parseAutoLockOffsetMinutes('1.5')).toBe(-90);
  });

  it('rejects non-numeric or non-positive input instead of silently saving null', () => {
    expect(parseAutoLockOffsetMinutes('abc')).toBeUndefined();
    expect(parseAutoLockOffsetMinutes('0')).toBeUndefined();
    expect(parseAutoLockOffsetMinutes('-1')).toBeUndefined();
  });
});
