'use client';

/**
 * In-app MFA sheet for the po surface, used two ways:
 *  1. Voluntary self-service ("Enable MFA" in Profile) — MFA is fully optional
 *     for every role, no AAL2 requirement anywhere (#20 refinement 2026-07-02,
 *     migration 20260702120000_mfa_fully_optional). There is no gate to satisfy
 *     here; the sheet exists purely because the user asked to turn MFA on.
 *  2. `useMfaGate` step-up — a handful of specific sensitive DB writes (venue
 *     membership role/removal grants) still carry a narrow, RLS-level AAL2
 *     check independent of this refinement; a caller at AAL1 gets a generic
 *     "no access, or MFA required" error, and `guard`/`start` open this sheet
 *     to resolve it instead of dead-ending. This is NOT a blanket AAL2 gate —
 *     don't reintroduce one elsewhere without an explicit decision.
 * Either way: it challenges an existing verified factor, or — if none exists —
 * asks first ("Set up now") before enrolling one (QR + code); enroll() never
 * fires just from the sheet opening. On success the cookie-based browser
 * client upgrades the session to AAL2 and the caller retries the action.
 */
import { type JSX, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { Icon } from './icon';
import { Btn, Field, Label, Note } from './kit';
import { Sheet } from './shell';

/** True when a server action refused for lack of AAL2 (the step-up case). */
export function isAal2Error(error: unknown): boolean {
  return error instanceof Error && /\bMFA\b/i.test(error.message);
}

type Phase = 'loading' | 'challenge' | 'ask' | 'enroll' | 'error';

export function PoMfaSheet({
  onVerified,
  onClose,
  title = t.shared.mfaGate.title,
  subtitle = t.shared.mfaGate.subtitle,
}: {
  onVerified: () => void;
  onClose: () => void;
  /** Header copy — overridden for the voluntary "MFA inschakelen" flow (S4.3). */
  title?: string;
  subtitle?: string;
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An unverified factor we created here; dropped on cancel so it doesn't linger.
  const enrolledIdRef = useRef<string | null>(null);
  // Guards against a double-click on "Set up now" or "Try again" firing two
  // concurrent enroll() calls — a state check alone can't catch same-tick clicks.
  const enrollInFlight = useRef(false);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        setError(t.shared.mfaGate.loadError);
        setPhase('error');
        return;
      }
      const verified = (data?.all ?? []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
      if (verified) {
        setFactorId(verified.id);
        setPhase('challenge');
        return;
      }
      // No verified factor — ask first; nothing is enrolled just from opening the sheet.
      setPhase('ask');
    })();
  }, []);

  async function startEnrollment(): Promise<void> {
    if (enrollInFlight.current) return;
    enrollInFlight.current = true;
    setError(null);
    try {
      const supabase = createClient();
      // Clean up abandoned, unverified TOTP factors so re-enrolling is idempotent.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.factor_type === 'totp' && f.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (enrollError || !enrolled) {
        setError(t.shared.mfaGate.startError);
        setPhase('error');
        return;
      }
      enrolledIdRef.current = enrolled.id;
      setFactorId(enrolled.id);
      setQr(enrolled.totp.qr_code);
      setSecret(enrolled.totp.secret);
      setPhase('enroll');
    } finally {
      enrollInFlight.current = false;
    }
  }

  async function verify(): Promise<void> {
    if (!factorId || code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyError) {
      setError(t.shared.mfaGate.codeError);
      setCode('');
      return;
    }
    enrolledIdRef.current = null; // verified now — keep the factor
    onVerified();
  }

  async function cancel(): Promise<void> {
    const id = enrolledIdRef.current;
    if (id) {
      try {
        await createClient().auth.mfa.unenroll({ factorId: id });
      } catch {
        /* best-effort cleanup */
      }
    }
    onClose();
  }

  return (
    <Sheet onClose={() => void cancel()} center={false}>
      <div className="mb-3 flex items-center gap-[12px]">
        <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px] bg-acc-dim text-acc">
          <Icon name="shield" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[16px] font-bold text-text">{title}</div>
          <div className="text-[12px] text-faint">{subtitle}</div>
        </div>
      </div>

      {phase === 'loading' && <div className="py-6 text-center text-[13px] text-faint">{t.shared.mfaGate.loading}</div>}

      {phase === 'ask' && (
        <>
          <Note icon="shield">{t.shared.mfaGate.setupIntro}</Note>
          <Btn kind="primary" full icon="shield" className="mt-2" onClick={() => void startEnrollment()}>
            {t.shared.mfaGate.setupNow}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => void cancel()}>
            {t.shared.mfaGate.cancel}
          </Btn>
        </>
      )}

      {phase === 'error' && (
        <>
          <Note icon="warn">{error ?? t.shared.mfaGate.genericError}</Note>
          <Btn kind="ghost" full onClick={() => void cancel()}>
            {t.shared.mfaGate.close}
          </Btn>
        </>
      )}

      {phase === 'enroll' && (
        <>
          <Note icon="shield">{t.shared.mfaGate.enrollNote}</Note>
          {qr && (
            <div className="mb-3 flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- QR is an inline SVG data-URI from GoTrue, not a static asset */}
              <img src={qr} alt={t.shared.mfaGate.qrAlt} className="h-[176px] w-[176px] rounded-[12px] bg-white p-2" />
            </div>
          )}
          {secret && (
            <div className="mb-3 break-all rounded-[12px] border border-line bg-elev2 px-3 py-2 text-center font-mono text-[12px] text-dim">
              {secret}
            </div>
          )}
        </>
      )}

      {(phase === 'enroll' || phase === 'challenge') && (
        <>
          <Label className="mb-2">{t.shared.mfaGate.codeLabel}</Label>
          <Field
            icon="shield"
            value={code}
            onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="000000"
            autoFocus
            className="mb-1.5"
          />
          {error && (
            <p className="mb-1 text-[12.5px] text-red-300" role="alert">
              {error}
            </p>
          )}
          <Btn
            kind="primary"
            full
            icon="check"
            className={cn('mt-2', code.length !== 6 && 'opacity-[0.45]')}
            disabled={code.length !== 6 || busy}
            onClick={() => void verify()}
          >
            {busy ? t.shared.mfaGate.verifying : t.shared.mfaGate.verify}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => void cancel()}>
            {t.shared.mfaGate.cancel}
          </Btn>
        </>
      )}
    </Sheet>
  );
}

export interface MfaGate {
  /**
   * If `error` is the AAL2-required error, open the step-up sheet and remember
   * `retry` to run after the session is upgraded. Returns true when it handled
   * the error (so the caller can suppress its own error UI).
   */
  guard: (error: unknown, retry: () => void) => boolean;
  /**
   * Open the step-up sheet PROACTIVELY (not from an error) — e.g. an AAL2-gated
   * READ like the audit log, where RLS returns [] instead of throwing. `retry`
   * runs once the session reaches AAL2.
   */
  start: (retry: () => void) => void;
  /** Render this in the component tree — it's the step-up sheet when open. */
  sheet: ReactNode;
}

export function useMfaGate(): MfaGate {
  const [open, setOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);

  const guard = (error: unknown, retry: () => void): boolean => {
    if (!isAal2Error(error)) return false;
    retryRef.current = retry;
    setOpen(true);
    return true;
  };

  const start = (retry: () => void): void => {
    retryRef.current = retry;
    setOpen(true);
  };

  const sheet = open ? (
    <PoMfaSheet
      onClose={() => setOpen(false)}
      onVerified={() => {
        setOpen(false);
        const retry = retryRef.current;
        retryRef.current = null;
        retry?.();
      }}
    />
  ) : null;

  return { guard, start, sheet };
}
