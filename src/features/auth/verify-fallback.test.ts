import { describe, expect, it, vi } from 'vitest';
import {
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

  it('falls back from a link to ONE type in the other token slot, never a same-slot twin', () => {
    // invite ≡ signup live in confirmation_token, magiclink ≡ email ≡ recovery
    // in recovery_token: retrying a same-slot twin can never find anything new.
    expect(linkVerifyTypes('invite')).toEqual(['invite', 'magiclink']);
    expect(linkVerifyTypes('signup')).toEqual(['signup', 'magiclink']);
    expect(linkVerifyTypes('magiclink')).toEqual(['magiclink', 'invite']);
    expect(linkVerifyTypes('email')).toEqual(['email', 'invite']);
  });

  it('never falls back from, or to, a flow of its own', () => {
    expect(linkVerifyTypes('email_change')).toEqual(['email_change']);
    expect(linkVerifyTypes('recovery')).toEqual(['recovery']);
    for (const declared of ['invite', 'signup', 'magiclink', 'email'] as const) {
      expect(linkVerifyTypes(declared)).not.toContain('email_change');
      expect(linkVerifyTypes(declared)).not.toContain('recovery');
    }
  });

  it('costs at most two verifies per link click (server-side amplification budget)', () => {
    for (const declared of ['signup', 'invite', 'magiclink', 'email', 'recovery', 'email_change'] as const) {
      const types = linkVerifyTypes(declared);
      expect(types.length).toBeLessThanOrEqual(2);
      expect(new Set(types).size).toBe(types.length);
      expect(types[0]).toBe(declared);
    }
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

  it('surfaces a LATE rate limit instead of burying it under the first slot miss', async () => {
    // Otherwise the user reads "that code didn't work" and the resend cooldown
    // never starts, so they hammer a rate-limited endpoint (S2).
    const attempt = vi.fn(async (type: string) => ({ error: type === 'email' ? mismatch : rateLimited }));

    const out = await verifyWithFallback([...OTP_CODE_VERIFY_TYPES], attempt);

    expect(out.error).toBe(rateLimited);
    expect(out.tried).toEqual(['email', 'signup']);
  });

  it('attempts each type at most once even if the list repeats one', async () => {
    const attempt = vi.fn(async () => ({ error: mismatch }));

    const out = await verifyWithFallback(['email', 'email', 'signup'], attempt);

    expect(out.tried).toEqual(['email', 'signup']);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
