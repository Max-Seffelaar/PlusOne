import { describe, it, expect } from 'vitest';
import {
  submitGuestRequestSchema,
  approveGuestRequestSchema,
  denyGuestRequestSchema,
  submitGuestRequestResultSchema,
} from './schemas';

const EVENT = '00000000-0000-7000-8000-000000000001';
const TIER = '00000000-0000-7000-8000-000000000002';
const REQ = '00000000-0000-7000-8000-000000000003';

/** A complete, valid submission — the base every case below varies from. Since
 *  86eyke279 e-mail AND phone are part of the minimum, so "name only" is no
 *  longer a valid request anywhere in this file. */
const VALID = {
  slug: 'frenzy-x4',
  fullName: 'Jip Jansen',
  email: 'jip@voorbeeld.nl',
  phone: '+31612345678',
} as const;

describe('submitGuestRequestSchema', () => {
  it('accepts a complete request and defaults plusOnes to 0', () => {
    const r = submitGuestRequestSchema.safeParse(VALID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.plusOnes).toBe(0);
      expect(r.data.email).toBe('jip@voorbeeld.nl');
      expect(r.data.phone).toBe('+31612345678');
      expect(r.data.fullName).toBe('Jip Jansen');
    }
  });

  it('trims the name and rejects one shorter than 2 chars', () => {
    expect(submitGuestRequestSchema.safeParse({ ...VALID, fullName: ' J ' }).success).toBe(false);
    const r = submitGuestRequestSchema.safeParse({ ...VALID, fullName: '  Noa Bos  ' });
    expect(r.success && r.data.fullName).toBe('Noa Bos');
  });

  // ── 86eyke279: e-mail + phone are hard-required on the public request form ──
  // Both are enforced AGAIN inside the submit_guest_request RPC (migration
  // 20260819110000); these tests only cover the app-path half.
  it('rejects a request without an e-mail — absent, empty and whitespace-only alike', () => {
    // `email: undefined` is the same case as an absent key for a required
    // Zod field, and avoids an unused destructured binding.
    expect(submitGuestRequestSchema.safeParse({ ...VALID, email: undefined }).success).toBe(false);
    expect(submitGuestRequestSchema.safeParse({ ...VALID, email: '' }).success).toBe(false);
    expect(submitGuestRequestSchema.safeParse({ ...VALID, email: '   ' }).success).toBe(false);
    expect(submitGuestRequestSchema.safeParse({ ...VALID, email: '\t\n ' }).success).toBe(false);
  });

  it('rejects a request without a phone — absent, empty and whitespace-only alike', () => {
    expect(submitGuestRequestSchema.safeParse({ ...VALID, phone: undefined }).success).toBe(false);
    expect(submitGuestRequestSchema.safeParse({ ...VALID, phone: '' }).success).toBe(false);
    expect(submitGuestRequestSchema.safeParse({ ...VALID, phone: '   ' }).success).toBe(false);
    expect(submitGuestRequestSchema.safeParse({ ...VALID, phone: '\u00a0' }).success).toBe(false);
  });

  it('rejects null for either contact field (not just undefined)', () => {
    expect(submitGuestRequestSchema.safeParse({ ...VALID, email: null }).success).toBe(false);
    expect(submitGuestRequestSchema.safeParse({ ...VALID, phone: null }).success).toBe(false);
  });

  it('reports a missing contact field as "required", not as a shape complaint', () => {
    const r = submitGuestRequestSchema.safeParse({ ...VALID, email: undefined });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Enter your email address');

    const blankPhone = submitGuestRequestSchema.safeParse({ ...VALID, phone: '  ' });
    expect(blankPhone.success).toBe(false);
    if (!blankPhone.success) {
      expect(blankPhone.error.issues[0]?.message).toBe('Enter your phone number');
    }
  });

  it('still rejects a malformed e-mail (shape check survives the required change)', () => {
    expect(submitGuestRequestSchema.safeParse({ ...VALID, email: 'nope' }).success).toBe(false);
  });

  // 86eyd3men: server-side follows the same rule as the form's inline
  // isValidEmail (both import EMAIL_RE from validation.ts) — a request that
  // slips past the client check would otherwise be silently rejected here.
  it('applies the same e-mail sanity check as the client (EMAIL_RE)', () => {
    const ok = submitGuestRequestSchema.safeParse({ ...VALID, email: 'noa@voorbeeld.nl' });
    expect(ok.success).toBe(true);
    expect(
      submitGuestRequestSchema.safeParse({ ...VALID, email: 'noa@hoiu.d' }).success
    ).toBe(false); // TLD too short
    expect(
      submitGuestRequestSchema.safeParse({ ...VALID, email: 'noa@hoiu..com' }).success
    ).toBe(false); // double dot
  });

  it('trims a padded e-mail and phone instead of rejecting them', () => {
    const r = submitGuestRequestSchema.safeParse({
      ...VALID,
      email: '  noa@voorbeeld.nl  ',
      phone: '  +31612345678  ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('noa@voorbeeld.nl');
      expect(r.data.phone).toBe('+31612345678');
    }
  });

  it('coerces plusOnes and bounds it to 0..20', () => {
    const r = submitGuestRequestSchema.safeParse({ ...VALID, plusOnes: '3' });
    expect(r.success && r.data.plusOnes).toBe(3);
    expect(submitGuestRequestSchema.safeParse({ ...VALID, plusOnes: 21 }).success).toBe(false);
    expect(submitGuestRequestSchema.safeParse({ ...VALID, plusOnes: -1 }).success).toBe(false);
  });

  it('rejects a slug with illegal characters', () => {
    expect(submitGuestRequestSchema.safeParse({ ...VALID, slug: 'bad slug!' }).success).toBe(false);
  });

  it('keeps the honeypot field (the action, not the schema, drops it)', () => {
    const r = submitGuestRequestSchema.safeParse({ ...VALID, company: 'Acme BV' });
    expect(r.success && r.data.company).toBe('Acme BV');
  });

  it('requires the phone to be E.164 (with country code)', () => {
    const ok = submitGuestRequestSchema.safeParse({ ...VALID, phone: '+31612345678' });
    expect(ok.success && ok.data.phone).toBe('+31612345678');
    // A bare national number (no country code) is rejected.
    expect(submitGuestRequestSchema.safeParse({ ...VALID, phone: '0612345678' }).success).toBe(false);
  });

  it('defaults marketingOptIn to false and accepts an explicit true', () => {
    const def = submitGuestRequestSchema.safeParse(VALID);
    expect(def.success && def.data.marketingOptIn).toBe(false);
    const on = submitGuestRequestSchema.safeParse({ ...VALID, marketingOptIn: true });
    expect(on.success && on.data.marketingOptIn).toBe(true);
  });
});

describe('approveGuestRequestSchema', () => {
  it('requires valid uuids for request and tier', () => {
    expect(approveGuestRequestSchema.safeParse({ requestId: REQ, tierId: TIER }).success).toBe(true);
    expect(
      approveGuestRequestSchema.safeParse({ requestId: 'x', tierId: TIER }).success
    ).toBe(false);
  });

  it('allows an optional eventId for revalidation', () => {
    const r = approveGuestRequestSchema.safeParse({ requestId: REQ, tierId: TIER, eventId: EVENT });
    expect(r.success).toBe(true);
  });
});

describe('denyGuestRequestSchema', () => {
  it('requires a non-empty reason', () => {
    expect(
      denyGuestRequestSchema.safeParse({ requestId: REQ, reason: 'Lijst vol' }).success
    ).toBe(true);
    expect(denyGuestRequestSchema.safeParse({ requestId: REQ, reason: '   ' }).success).toBe(false);
  });
});

describe('submitGuestRequestResultSchema', () => {
  it('accepts a real success, with or without auto_approved', () => {
    expect(submitGuestRequestResultSchema.safeParse({ status: 'ok', auto_approved: true }).success).toBe(true);
    expect(submitGuestRequestResultSchema.safeParse({ status: 'rate_limited' }).success).toBe(true);
    expect(submitGuestRequestResultSchema.safeParse({ status: 'closed' }).success).toBe(true);
    expect(submitGuestRequestResultSchema.safeParse({ status: 'invalid' }).success).toBe(true);
  });

  it('lets a non-boolean auto_approved (display-only) fail open instead of vetoing a real status', () => {
    const r = submitGuestRequestResultSchema.safeParse({ status: 'ok', auto_approved: 'yes' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.auto_approved === true).toBe(false); // caller's `=== true` check still fails safe
  });

  it('rejects a missing/empty result — status is required, not optional', () => {
    expect(submitGuestRequestResultSchema.safeParse({}).success).toBe(false);
    expect(submitGuestRequestResultSchema.safeParse(null).success).toBe(false);
    expect(submitGuestRequestResultSchema.safeParse(undefined).success).toBe(false);
  });

  it('rejects a bare string and an unrecognized status value', () => {
    expect(submitGuestRequestResultSchema.safeParse('ok').success).toBe(false);
    expect(submitGuestRequestResultSchema.safeParse({ status: 'huh' }).success).toBe(false);
  });
});
