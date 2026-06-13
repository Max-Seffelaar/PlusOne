import { describe, it, expect } from 'vitest';
import { describeAuthError, parseRetryAfterSeconds } from './errors';

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
  it('maps rate limits (status 429) to Dutch with a countdown', () => {
    const r = describeAuthError({
      status: 429,
      message: 'For security purposes, you can only request this after 30 seconds.',
    });
    expect(r.retryAfterSeconds).toBe(30);
    expect(r.message).toContain('30 seconden');
  });

  it('maps a rate-limit code without a number to a generic wait message', () => {
    const r = describeAuthError({ code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' });
    expect(r.message).toContain('Te veel pogingen');
    expect(r.retryAfterSeconds).toBeUndefined();
  });

  it('maps expired/invalid OTP', () => {
    expect(describeAuthError({ code: 'otp_expired' }).message).toContain('ongeldig of verlopen');
    expect(
      describeAuthError({ message: 'Token has expired or is invalid' }).message
    ).toContain('ongeldig of verlopen');
  });

  it('maps MFA verification failure', () => {
    expect(describeAuthError({ code: 'mfa_verification_failed' }).message).toContain('Verificatiecode');
  });

  it('maps signups-disabled to an invite hint (invite-only)', () => {
    expect(describeAuthError({ message: 'Signups not allowed for otp' }).message).toContain('uitnodiging');
  });

  it('maps RLS / privilege denial to a generic access message', () => {
    expect(describeAuthError({ code: '42501' }).message).toContain('geen toegang');
    expect(describeAuthError({ message: 'new row violates row-level security policy' }).message).toContain(
      'geen toegang'
    );
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(describeAuthError({ message: 'kaboom' }).message).toBe('Er ging iets mis. Probeer het opnieuw.');
    expect(describeAuthError(null).message).toBe('Er ging iets mis. Probeer het opnieuw.');
    expect(describeAuthError(undefined).message).toBe('Er ging iets mis. Probeer het opnieuw.');
  });
});
