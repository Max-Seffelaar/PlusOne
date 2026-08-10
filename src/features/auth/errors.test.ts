import { describe, it, expect } from 'vitest';
import { describeAuthError, parseRetryAfterSeconds, isUnknownAccountOtpError } from './errors';

describe('parseRetryAfterSeconds', () => {
  it('extracts the wait time from GoTrue rate-limit text', () => {
    expect(parseRetryAfterSeconds('For security purposes, you can only request this after 23 seconds.')).toBe(23);
    expect(parseRetryAfterSeconds('after 1 second')).toBe(1);
  });
  it('returns undefined when there is no number', () => {
    expect(parseRetryAfterSeconds('something else')).toBeUndefined();
  });
});

describe('describeAuthError', () => {
  it('maps rate limits (status 429) to a message with a countdown', () => {
    const r = describeAuthError({
      status: 429,
      message: 'For security purposes, you can only request this after 30 seconds.',
    });
    expect(r.retryAfterSeconds).toBe(30);
    expect(r.message).toContain('30 seconds');
  });

  it('maps a rate-limit code without a number to a generic wait message', () => {
    const r = describeAuthError({ code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' });
    expect(r.message).toContain('Too many tries');
    expect(r.retryAfterSeconds).toBeUndefined();
  });

  it('maps expired/invalid OTP', () => {
    expect(describeAuthError({ code: 'otp_expired' }).message).toContain('has expired');
    expect(
      describeAuthError({ message: 'Token has expired or is invalid' }).message
    ).toContain('has expired');
  });

  it('maps MFA verification failure', () => {
    expect(describeAuthError({ code: 'mfa_verification_failed' }).message).toContain('verification code');
  });

  it('maps signups-disabled to an invite hint (invite-only)', () => {
    expect(describeAuthError({ message: 'Signups not allowed for otp' }).message).toContain('invite');
  });

  it('maps RLS / privilege denial to a generic access message', () => {
    expect(describeAuthError({ code: '42501' }).message).toContain("don't have access");
    expect(describeAuthError({ message: 'new row violates row-level security policy' }).message).toContain(
      "don't have access"
    );
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(describeAuthError({ message: 'kaboom' }).message).toBe('Something went wrong. Try again.');
    expect(describeAuthError(null).message).toBe('Something went wrong. Try again.');
    expect(describeAuthError(undefined).message).toBe('Something went wrong. Try again.');
  });
});

describe('isUnknownAccountOtpError (86ey9ea00 #53 — login-form account-enumeration guard)', () => {
  it('is true for the signup_disabled code', () => {
    expect(isUnknownAccountOtpError({ code: 'signup_disabled' })).toBe(true);
  });

  it('is true for the "signups not allowed" message text', () => {
    expect(isUnknownAccountOtpError({ message: 'Signups not allowed for otp' })).toBe(true);
  });

  it('is false for an unrelated error, so real failures still surface', () => {
    expect(isUnknownAccountOtpError({ status: 429, message: 'rate limited' })).toBe(false);
    expect(isUnknownAccountOtpError({ code: 'otp_expired' })).toBe(false);
    expect(isUnknownAccountOtpError(null)).toBe(false);
    expect(isUnknownAccountOtpError(undefined)).toBe(false);
  });
});
