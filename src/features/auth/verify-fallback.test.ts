import { describe, expect, it, vi } from 'vitest';
import {
  LINK_VERIFY_FALLBACK_TYPES,
  OTP_CODE_VERIFY_TYPES,
  isVerifyTypeMismatchError,
  linkVerifyTypes,
  verifyWithFallback,
} from './verify-fallback';

const mismatch = { status: 403, message: 'Token has expired or is invalid' };
const notFound = { status: 404, message: 'One-time token not found' };
const rateLimited = { status: 429, message: 'Email rate limit exceeded' };

describe('verify type lists', () => {
  it('tries the everyday magic-link/OTP slot first, then the two confirmation slots', () => {
    expect([...OTP_CODE_VERIFY_TYPES]).toEqual(['email', 'signup', 'invite']);
  });

  it('puts the type the link declared first and completes it with the other first-login slots', () => {
    expect(linkVerifyTypes('invite')).toEqual(['invite', 'signup', 'magiclink', 'email']);
    expect(linkVerifyTypes('signup')).toEqual(['signup', 'invite', 'magiclink', 'email']);
    expect(linkVerifyTypes('magiclink')).toEqual(['magiclink', 'signup', 'invite', 'email']);
    // No duplicates, ever — a type must not be retried just because it leads.
    for (const declared of LINK_VERIFY_FALLBACK_TYPES) {
      const types = linkVerifyTypes(declared);
      expect(new Set(types).size).toBe(types.length);
    }
  });

  it('never falls back out of a flow of its own (email_change / recovery)', () => {
    expect(linkVerifyTypes('email_change')).toEqual(['email_change']);
    expect(linkVerifyTypes('recovery')).toEqual(['recovery']);
  });
});

describe('isVerifyTypeMismatchError', () => {
  it('treats GoTrue 403/404 token errors as retryable in another slot', () => {
    expect(isVerifyTypeMismatchError(mismatch)).toBe(true);
    expect(isVerifyTypeMismatchError(notFound)).toBe(true);
    expect(isVerifyTypeMismatchError({ code: 'otp_expired', message: 'Token has expired' })).toBe(true);
  });

  it('never retries through a rate limit', () => {
    expect(isVerifyTypeMismatchError(rateLimited)).toBe(false);
    expect(isVerifyTypeMismatchError({ code: 'over_email_send_rate_limit', message: 'rate limit' })).toBe(false);
  });

  it('does not retry unrelated failures', () => {
    expect(isVerifyTypeMismatchError({ status: 500, message: 'Internal server error' })).toBe(false);
    expect(isVerifyTypeMismatchError(null)).toBe(false);
  });
});

describe('verifyWithFallback', () => {
  it('stops at the first type that works and never retries a valid type', async () => {
    const attempt = vi.fn(async () => ({ data: { user: 'u' }, error: null }));

    const out = await verifyWithFallback([...OTP_CODE_VERIFY_TYPES], attempt);

    expect(out.type).toBe('email');
    expect(out.error).toBeUndefined();
    expect(out.tried).toEqual(['email']);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('falls through email → signup for a never-confirmed invitee, without trying invite', async () => {
    const attempt = vi.fn(async (type: string) =>
      type === 'signup' ? { data: { user: 'u' }, error: null } : { error: mismatch }
    );

    const out = await verifyWithFallback([...OTP_CODE_VERIFY_TYPES], attempt);

    expect(out.type).toBe('signup');
    expect(out.tried).toEqual(['email', 'signup']);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('reaches the invite slot when both earlier slots miss', async () => {
    const attempt = vi.fn(async (type: string) =>
      type === 'invite' ? { data: { user: 'u' }, error: null } : { error: notFound }
    );

    const out = await verifyWithFallback([...OTP_CODE_VERIFY_TYPES], attempt);

    expect(out.type).toBe('invite');
    expect(out.tried).toEqual(['email', 'signup', 'invite']);
  });

  it('surfaces the FIRST error (the declared type’s) when every slot misses', async () => {
    const attempt = vi.fn(async (type: string) => ({ error: type === 'email' ? mismatch : notFound }));

    const out = await verifyWithFallback([...OTP_CODE_VERIFY_TYPES], attempt);

    expect(out.type).toBeUndefined();
    expect(out.error).toBe(mismatch);
    expect(out.tried).toEqual(['email', 'signup', 'invite']);
  });

  it('aborts immediately on a rate limit instead of burning the remaining slots', async () => {
    const attempt = vi.fn(async () => ({ error: rateLimited }));

    const out = await verifyWithFallback([...OTP_CODE_VERIFY_TYPES], attempt);

    expect(out.error).toBe(rateLimited);
    expect(out.tried).toEqual(['email']);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('attempts each type at most once even if the list repeats one', async () => {
    const attempt = vi.fn(async () => ({ error: mismatch }));

    const out = await verifyWithFallback(['email', 'email', 'signup'], attempt);

    expect(out.tried).toEqual(['email', 'signup']);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
