'use client';

/** First-login consent gate (#20/#40): accept Terms + Privacy before using the
 *  app. Records consent via acceptTermsAction, then continues to `next`. */
import { useState, useTransition } from 'react';
import { AUTH_GRADIENT } from '@/lib/po/theme';
import { Icon } from '@/components/po/icon';
import { Btn } from '@/components/po/kit';
import { TERMS_URL, PRIVACY_URL } from '@/lib/legal';
import { acceptTermsAction } from '@/features/auth/consent-actions';

export function ConsentScreen({ next, email }: { next: string; email: string }): JSX.Element {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    if (!agreed || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await acceptTermsAction();
      if (!res.ok) {
        setError(res.error ?? 'Er ging iets mis.');
        return;
      }
      // Full navigation so the server re-evaluates the gate and lands on `next`.
      window.location.assign(next);
    });
  }

  return (
    <div
      className="flex h-[100dvh] flex-col items-center justify-center overflow-y-auto px-6 py-10"
      style={{ background: AUTH_GRADIENT }}
    >
      <div className="w-full max-w-[460px]">
        <span className="mb-6 inline-flex items-center gap-[7px] rounded-full bg-acc-dim px-3 py-[6px] font-body text-[12.5px] font-bold text-acc">
          <Icon name="shield" size={14} sw={2.6} />
          Even akkoord
        </span>
        <h1 className="m-0 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em] text-text">
          Voorwaarden & privacy
        </h1>
        <p className="mt-4 text-[15px] leading-[1.5] text-dim">
          Voordat je verdergaat
          {email ? (
            <>
              {' '}
              als <span className="text-text">{email}</span>
            </>
          ) : null}
          , vragen we je akkoord te gaan met onze voorwaarden en ons privacybeleid.
        </p>

        <label className="mt-7 flex cursor-pointer items-start gap-[12px] rounded-[16px] border border-line bg-elev p-4">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-[3px] h-[20px] w-[20px] shrink-0 accent-acc"
          />
          <span className="text-[13.5px] leading-[1.5] text-text">
            Ik ga akkoord met de{' '}
            <a href={TERMS_URL} target="_blank" rel="noreferrer" className="font-semibold text-acc underline">
              Algemene Voorwaarden
            </a>{' '}
            en het{' '}
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="font-semibold text-acc underline">
              Privacybeleid
            </a>
            .
          </span>
        </label>

        {error && <div className="mt-3 text-[13.5px] leading-[1.45] text-[#ff9b9b]">{error}</div>}

        <Btn
          kind="primary"
          full
          icon="arrowR"
          onClick={submit}
          disabled={!agreed || pending}
          className={`mt-6 ${agreed ? '' : 'opacity-[0.45]'}`}
        >
          {pending ? 'Bezig…' : 'Akkoord & doorgaan'}
        </Btn>
      </div>
    </div>
  );
}
