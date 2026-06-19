import { describe, it, expect } from 'vitest';
import { devTotpCode } from './dev-totp';

// RFC 6238 Appendix B vectors (SHA-1, ASCII secret "12345678901234567890" =
// base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"). The RFC lists 8-digit codes; we
// take the 6-digit tail the app uses.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('devTotpCode', () => {
  it('matches the RFC 6238 SHA-1 vectors (6-digit tail)', () => {
    expect(devTotpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(devTotpCode(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(devTotpCode(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
  });

  it('is stable within a 30s window and rotates across windows', () => {
    expect(devTotpCode(RFC_SECRET, 0)).toBe(devTotpCode(RFC_SECRET, 29_000));
    expect(devTotpCode(RFC_SECRET, 0)).not.toBe(devTotpCode(RFC_SECRET, 30_000));
  });

  it('ignores spaces/casing in the secret', () => {
    expect(devTotpCode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', 59_000)).toBe('287082');
  });
});
