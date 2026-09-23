'use client';

import { type JSX, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { describeAuthError, isUnknownAccountOtpError } from '@/features/auth/errors';
import { requestOtpSchema, verifyOtpSchema } from '@/features/auth/schemas';
import { OTP_CODE_VERIFY_TYPES, verifyWithFallback } from '@/features/auth/verify-fallback';

type Step = 'email' | 'code';

/**
 * Messages for the `?error=` values the auth routes bounce back here with.
 * Every one of them ends on this screen, so every one of them needs copy — a
 * value with none renders a blank, dead-end page (P-01).
 */
export const LOGIN_ERROR_MESSAGES = {
  /** /auth/confirm could not verify an e-mail link. */
  link: "That link didn't work — it may already have been used, or a newer email replaced it. Enter your email below and we'll send you a fresh code.",
  /** The local-only dev-login shortcut failed; never reachable in production. */
  devlogin: 'Dev login failed. Use your email and a code instead.',
} as const;

export type LoginErrorKind = keyof typeof LOGIN_ERROR_MESSAGES;

export function OtpLoginForm({
  nextPath,
  errorKind,
}: {
  nextPath: string;
  /** Why an auth route sent the user back here, if it did. */
  errorKind?: LoginErrorKind;
}): JSX.Element {
  const supabase = createClient();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(errorKind ? LOGIN_ERROR_MESSAGES[errorKind] : null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // Rate-limit countdown for the resend button.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus();
  }, [step]);

  async function sendCode(targetEmail: string): Promise<void> {
    const parsed = requestOtpSchema.safeParse({ email: targetEmail });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid email');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    // Invite-only: never create a user from the login screen (decision #20).
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    // An unknown/uninvited address must look identical to a known one — same
    // step transition, same message — or the response shape itself reveals
    // whether the account exists (account enumeration, 86ey9ea00 #53). Real
    // failures (rate limits, network errors) still surface below.
    if (otpError && !isUnknownAccountOtpError(otpError)) {
      const normalized = describeAuthError(otpError);
      setError(normalized.message);
      if (normalized.retryAfterSeconds) setCooldown(normalized.retryAfterSeconds);
      return;
    }
    setEmail(parsed.data.email);
    setStep('code');
    setInfo(`We sent a 6-digit code to ${parsed.data.email}.`);
    setCooldown(60);
  }

  async function verify(tokenValue: string = code): Promise<void> {
    // The code input auto-submits at six digits AND the form can be submitted
    // by hand, so two verifies could otherwise run at once — now up to three
    // GoTrue round trips each (PR #324 review). One at a time.
    if (busy) return;
    const parsed = verifyOtpSchema.safeParse({ email, token: tokenValue });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid code');
      return;
    }
    setBusy(true);
    setError(null);
    // The 6-digit code looks the same whichever slot GoTrue filed it in: an
    // invitee who never confirmed their address has it in the confirmation /
    // invite slot, not the magic-link one. Verifying only as `email` turned a
    // perfectly valid code into a 403 for every first-time invitee (P-01), so
    // try the slots in order and stop at the first one that is accepted.
    const { error: verifyError } = await verifyWithFallback(
      [...OTP_CODE_VERIFY_TYPES],
      (type) =>
        supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.token, type })
    );
    if (verifyError) {
      setBusy(false);
      setError(describeAuthError(verifyError).message);
      return;
    }
    // Full navigation so the freshly-set auth cookies reach the server, which
    // accepts any pending invites before landing the user in the app. `replace`
    // (not `assign`) so /login doesn't linger in history — otherwise a back from
    // /app bounces through the login→/app redirect and feels like a trap.
    window.location.replace(`/auth/callback?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="font-display text-4xl font-extrabold tracking-tight">PLUSONE</h1>
        <p className="text-dim mt-2 text-sm">The guest list that runs the door.</p>
      </div>

      <div className="card">
        {step === 'email' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode(email);
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@venue.com"
                className="field"
                aria-describedby={error ? 'auth-error' : undefined}
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
            <p className="text-faint text-center text-xs">
              Invite only. No passwords here. We&apos;ll email you a 6-digit code.
            </p>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="code" className="label">
                Your code
              </label>
              <input
                id="code"
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode(v);
                  // Auto-submit once the code is complete. Pass the fresh value
                  // explicitly — `code` state is stale inside this closure.
                  if (v.length === 6) setTimeout(() => void verify(v), 0);
                }}
                placeholder="000000"
                className="field text-center text-2xl tracking-[0.5em]"
                aria-describedby={error ? 'auth-error' : 'auth-info'}
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                className="text-dim hover:text-text transition-colors disabled:opacity-50"
                disabled={cooldown > 0 || busy}
                onClick={() => void sendCode(email)}
              >
                {cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
              </button>
              <button
                type="button"
                className="text-faint hover:text-text transition-colors"
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                  setInfo(null);
                }}
              >
                Use another email
              </button>
            </div>
            {/* Shown unconditionally — never gated on whether a code was
                actually sent (86ey9ea00 #53/#54 review) — so an invited-but-
                not-yet-accepted account has a way forward, without this hint
                itself becoming a second account-existence signal. */}
            <p className="text-faint text-center text-xs">
              Didn&apos;t get a code? Double-check the address, or ask an admin to resend your invite.
            </p>
          </form>
        )}

        {info && !error && (
          <p id="auth-info" className="text-dim mt-4 text-center text-sm" role="status">
            {info}
          </p>
        )}
        {error && (
          <p id="auth-error" className="text-acc-soft mt-4 text-center text-sm" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
