import { createHmac } from 'node:crypto';

/**
 * Minimal RFC 6238 TOTP generator — DEV ONLY. Used by the dev-login route to
 * compute the code for a freshly-enrolled TOTP factor so a seeded admin/finance
 * session can reach AAL2 without an authenticator app. Never used in production
 * (the dev routes 404 there). Kept pure (time is injectable) for testing.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotp(secret: string, atMs: number = Date.now(), stepSeconds = 30, digits = 6): string {
  const key = base32Decode(secret);

  // 8-byte big-endian time counter (division avoids 32-bit shift overflow).
  let counter = Math.floor(atMs / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    msg[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }

  const hmac = createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}
