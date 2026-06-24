'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { describeAuthError } from '@/features/auth/errors';
import { totpSchema } from '@/features/auth/schemas';

// Step-up challenge: a user with a verified TOTP factor on an AAL1 session
// proves the second factor to reach AAL2 (required for sensitive routes).
export function MfaChallengeForm({ nextPath }: { nextPath: string }): JSX.Element {
  const supabase = createClient();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = (data?.all ?? []).find(
        (f) => f.factor_type === 'totp' && f.status === 'verified'
      );
      if (verified) {
        setFactorId(verified.id);
        inputRef.current?.focus();
      } else {
        // No factor to challenge — send them to enrollment.
        window.location.assign('/mfa/enroll');
      }
    })();
  }, [supabase]);

  async function verify(): Promise<void> {
    if (!factorId) return;
    const parsed = totpSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid code');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: parsed.data,
    });
    if (verifyError) {
      setBusy(false);
      setError(describeAuthError(verifyError).message);
      return;
    }
    window.location.assign(nextPath);
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut();
    window.location.assign('/login');
  }

  return (
    <div className="card w-full max-w-sm">
      <h1 className="font-display text-2xl font-bold">Verify it&apos;s you</h1>
      <p className="text-dim mt-1 text-sm">
        Enter the 6-digit code from your authenticator app to continue.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
        className="mt-4 flex flex-col gap-4"
        noValidate
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="field text-center text-2xl tracking-[0.5em]"
          aria-label="Verification code"
        />
        <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        {error && (
          <p className="text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="text-faint hover:text-text text-center text-xs" onClick={() => void signOut()}>
          Log out
        </button>
      </form>
    </div>
  );
}
