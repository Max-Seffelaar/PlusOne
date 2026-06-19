import { createHmac } from 'node:crypto';

// RFC 6238 TOTP — LOCAL DEV ONLY.
//
// The dev-login route uses this to auto-complete the MFA challenge for the seed
// admin/finance accounts, which carry the FIXED dev secret stamped by
// scripts/dev-mfa.mjs. That turns admin login into one click locally — no
// authenticator app — without weakening prod: the dev-login route 404s in
// production, and this fixed secret only exists on the local stack.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decode an RFC 4648 base32 secret (the format authenticator apps display). */
function base32Decode(input: string): Buffer {
  let bits = '';
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // skip spaces / padding / stray chars
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Compute the RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30-second step) for a base32
 * secret at a given epoch-millisecond time. Pure given (secret, atMs) — unit-tested
 * against the RFC 6238 vectors.
 */
export function devTotpCode(base32Secret: string, atMs: number, step = 30, digits = 6): string {
  const key = base32Decode(base32Secret);
  const counter = Math.floor(atMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}
