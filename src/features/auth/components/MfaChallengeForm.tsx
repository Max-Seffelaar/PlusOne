'use client';

import { type JSX, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { describeAuthError } from '@/features/auth/errors';
import { totpSchema } from '@/features/auth/schemas';
import { PendingOutboxError, signOutDevice } from '@/features/auth/sign-out-device';

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
    // `replace` so the /mfa step doesn't linger behind /app in history.
    window.location.replace(nextPath);
  }

  // Full device sign-out, not a bare `auth.signOut()` (86ey9e9mn): this escape
  // hatch is reachable on a shared door tablet, and the previous user's
  // IndexedDB (outbox + guest snapshot) and Cache Storage (`/app` HTML with
  // their identity) have to go with the session. Scope 'global' matches the
  // old default. `signOutDevice` throws rather than redirect when the token
  // cannot be cleared — surface that instead of stranding the user silently.
  //
  // Un-synced door writes (86ey9et0h) surface here as a REFUSAL to sign out,
  // not as a prompt: this wall sits in front of an unverified session, so we
  // cannot show a trustworthy "how many check-ins you're about to delete"
  // dialog, and there is no legitimate reason to discard a doorhost's queued
  // check-ins from an authentication screen. Passing them the count and telling
  // them to reconnect keeps the recoverable path open — the entries sync
  // themselves the moment the device is online, and the sign-out then works.
  async function signOut(): Promise<void> {
    try {
      await signOutDevice('global');
    } catch (e) {
      setError(
        e instanceof PendingOutboxError
          ? `${e.pending} check-ins on this device haven't been synced yet. Reconnect so they upload, then sign out.`
          : 'Could not sign out — check your connection and try again.',
      );
    }
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
