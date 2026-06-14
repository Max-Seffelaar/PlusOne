import { describe, it, expect } from 'vitest';
import {
  submitGuestRequestSchema,
  approveGuestRequestSchema,
  denyGuestRequestSchema,
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
