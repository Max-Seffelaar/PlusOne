import { describe, expect, it } from 'vitest';
import { generateTotp } from './totp';

// RFC 6238 Appendix B reference vectors (SHA-1, 8-digit). The ASCII secret
// "12345678901234567890" is base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('generateTotp (RFC 6238 vectors)', () => {
  it('matches the 6-digit codes at the reference timestamps', () => {
    expect(generateTotp(SECRET, 59_000)).toBe('287082');
    expect(generateTotp(SECRET, 1_111_111_109_000)).toBe('081804');
    expect(generateTotp(SECRET, 1_234_567_890_000)).toBe('005924');
  });
});
