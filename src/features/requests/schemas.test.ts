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

describe('submitGuestRequestSchema', () => {
  it('accepts a name-only request and defaults plusOnes to 0', () => {
    const r = submitGuestRequestSchema.safeParse({ slug: 'frenzy-x4', fullName: 'Jip Jansen' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.plusOnes).toBe(0);
      expect(r.data.email).toBeUndefined();
      expect(r.data.fullName).toBe('Jip Jansen');
    }
  });

  it('trims the name and rejects one shorter than 2 chars', () => {
    expect(submitGuestRequestSchema.safeParse({ slug: 'a', fullName: ' J ' }).success).toBe(false);
    const r = submitGuestRequestSchema.safeParse({ slug: 'a', fullName: '  Noa Bos  ' });
    expect(r.success && r.data.fullName).toBe('Noa Bos');
  });

  it('treats an empty e-mail as "not provided" but rejects a malformed one', () => {
    const ok = submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', email: '' });
    expect(ok.success && ok.data.email).toBeUndefined();
    expect(
      submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', email: 'nope' }).success
    ).toBe(false);
  });

  // 86eyd3men: server-side follows the same rule as the form's inline
  // isValidEmail (both import EMAIL_RE from validation.ts) — a request that
  // slips past the client check would otherwise be silently rejected here.
  it('applies the same e-mail sanity check as the client (EMAIL_RE)', () => {
    const ok = submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', email: 'noa@voorbeeld.nl' });
    expect(ok.success).toBe(true);
    expect(
      submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', email: 'noa@hoiu.d' }).success
    ).toBe(false); // TLD too short
    expect(
      submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', email: 'noa@hoiu..com' }).success
    ).toBe(false); // double dot
  });

  it('coerces plusOnes and bounds it to 0..20', () => {
    const r = submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', plusOnes: '3' });
    expect(r.success && r.data.plusOnes).toBe(3);
    expect(
      submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', plusOnes: 21 }).success
    ).toBe(false);
    expect(
      submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', plusOnes: -1 }).success
    ).toBe(false);
  });

  it('rejects a slug with illegal characters', () => {
    expect(
      submitGuestRequestSchema.safeParse({ slug: 'bad slug!', fullName: 'Noa Bos' }).success
    ).toBe(false);
  });

  it('keeps the honeypot field (the action, not the schema, drops it)', () => {
    const r = submitGuestRequestSchema.safeParse({
      slug: 'a',
      fullName: 'Noa Bos',
      company: 'Acme BV',
    });
    expect(r.success && r.data.company).toBe('Acme BV');
  });

  it('requires the phone to be E.164 (with country code) when given', () => {
    const ok = submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', phone: '+31612345678' });
    expect(ok.success && ok.data.phone).toBe('+31612345678');
    const empty = submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', phone: '' });
    expect(empty.success && empty.data.phone).toBeUndefined();
    // A bare national number (no country code) is rejected.
    expect(
      submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', phone: '0612345678' }).success
    ).toBe(false);
  });

  it('defaults marketingOptIn to false and accepts an explicit true', () => {
    const def = submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos' });
    expect(def.success && def.data.marketingOptIn).toBe(false);
    const on = submitGuestRequestSchema.safeParse({ slug: 'a', fullName: 'Noa Bos', marketingOptIn: true });
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
