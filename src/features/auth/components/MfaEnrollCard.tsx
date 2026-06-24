'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { describeAuthError } from '@/features/auth/errors';
import { totpSchema } from '@/features/auth/schemas';

// TOTP enrollment (spec §5, decision #20). Shows the QR + manual secret, then
// verifies a code to immediately raise the session to AAL2.
export function MfaEnrollCard({ nextPath }: { nextPath: string }): JSX.Element {
  const supabase = createClient();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const startEnrollment = useCallback(async () => {
    setError(null);
    // Clean up abandoned, unverified TOTP factors so re-enrolling is idempotent.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of factors?.all ?? []) {
      if (f.factor_type === 'totp' && f.status === 'unverified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (enrollError || !data) {
      setError(describeAuthError(enrollError).message);
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
  }, [supabase]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startEnrollment();
  }, [startEnrollment]);

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
    // Session is now AAL2 — full navigation so the server picks up the new AAL.
    // `replace` so the /mfa step doesn't linger behind /app in history.
    window.location.replace(nextPath);
  }

  return (
    <div className="card w-full max-w-sm">
      <h1 className="font-display text-2xl font-bold">Set up two-factor</h1>
      <p className="text-dim mt-1 text-sm">
        Two-factor is required for your role. Scan the QR code with an authenticator app
        (e.g. Google Authenticator, 1Password), then enter the code.
      </p>

      {error && !qr ? (
        <div className="mt-4">
          <p className="mb-3 text-sm text-red-300" role="alert">
            {error}
          </p>
          <button type="button" className="btn-dark w-full" onClick={() => void startEnrollment()}>
            Try again
          </button>
        </div>
      ) : qr ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          className="mt-4 flex flex-col gap-4"
          noValidate
        >
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qr}
              alt="QR code for authenticator app"
              className="bg-text h-44 w-44 rounded-card p-2"
            />
          </div>
          {secret && (
            <p className="text-faint text-center text-xs">
              Enter it manually?{' '}
              <code className="text-dim break-all" data-testid="totp-secret">
                {secret}
              </code>
            </p>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="totp" className="label">
              Code from your app
            </label>
            <input
              id="totp"
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
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          {error && (
            <p className="text-sm text-red-300" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="text-dim mt-4 text-sm">Loading QR code…</p>
      )}
    </div>
  );
}
