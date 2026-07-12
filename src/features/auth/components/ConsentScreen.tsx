'use client';

/** First-login consent gate (#20/#40): accept Terms + Privacy before using the
 *  app. For a first-time user without a name this doubles as the ACCOUNT-SETUP
 *  step (T1 #3): first + last name required, phone optional but encouraged —
 *  one screen, one submit, then straight on to `next` (venue create or /app).
 *  Records everything via acceptTermsAction. */
import { useState, useTransition } from 'react';
import { t, fmt } from '@/lib/i18n';
import { AUTH_GRADIENT } from '@/lib/po/theme';
import { Icon } from '@/components/po/icon';
import { Btn, Field, Label } from '@/components/po/kit';
import { CountrySelect, type CountryCode } from '@/components/po/country-select';
import PhoneInput from 'react-phone-number-input/input';
import { TERMS_URL, PRIVACY_URL } from '@/lib/legal';
import { acceptTermsAction } from '@/features/auth/consent-actions';

export function ConsentScreen({
  next,
  email,
  needsDetails,
}: {
  next: string;
  email: string;
  /** True for a first-time user whose profile has no first/last name yet. */
  needsDetails: boolean;
}): JSX.Element {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('NL');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const detailsOk = !needsDetails || (firstName.trim() !== '' && lastName.trim() !== '');
  const canSubmit = agreed && detailsOk && !pending;

  function submit(): void {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const res = await acceptTermsAction(
        needsDetails
          ? { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone ?? '' }
          : undefined
      );
      if (!res.ok) {
        setError(res.error ?? t.auth.consentError);
        return;
      }
      // Full navigation so the server re-evaluates the gate and lands on `next`.
      // `replace` so this step doesn't linger behind /app in history.
      window.location.replace(next);
    });
  }

  return (
    // Centering via m-auto on the CHILD, not justify-center on the scroll
    // container: justify-center + overflow-y-auto clips the top half of
    // overflowing content unreachably (classic flexbox bug) — on a short
    // mobile viewport the account-setup variant (extra name/phone fields +
    // keyboard) lost its heading and checkbox off the top edge.
    <div
      className="flex min-h-[100dvh] flex-col items-center overflow-y-auto px-6"
      style={{ background: AUTH_GRADIENT }}
    >
      <div className="m-auto w-full max-w-[460px] py-10">
        <span className="mb-6 inline-flex items-center gap-[7px] rounded-full bg-acc-dim px-3 py-[6px] font-body text-[12.5px] font-bold text-acc">
          <Icon name="shield" size={14} sw={2.6} />
          {needsDetails ? t.auth.accountBadge : t.auth.consentBadge}
        </span>
        <h1 className="m-0 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em] text-text">
          {needsDetails ? t.auth.accountTitle : t.auth.consentTitle}
        </h1>
        <p className="mt-4 text-[15px] leading-[1.5] text-dim">
          {needsDetails ? t.auth.accountBody : t.auth.consentBody}
        </p>
        {email ? (
          <p className="mt-2 text-[13px] leading-[1.5] text-faint">
            {fmt(t.auth.consentSignedInAs, { email })}
          </p>
        ) : null}

        {needsDetails && (
          <div className="mt-7 flex flex-col">
            <Label className="mb-2">{t.auth.accountFirstName}</Label>
            <Field
              icon="user"
              value={firstName}
              onChange={setFirstName}
              placeholder={t.auth.accountFirstName}
              autoFocus
              className="mb-[14px]"
            />
            <Label className="mb-2">{t.auth.accountLastName}</Label>
            <Field
              icon="user"
              value={lastName}
              onChange={setLastName}
              placeholder={t.auth.accountLastName}
              className="mb-[14px]"
            />
            <Label className="mb-2">{t.auth.accountPhone}</Label>
            <div className="flex items-center gap-[11px] rounded-[14px] border border-line bg-elev px-[11px] py-[13px] transition-colors focus-within:border-acc">
              <CountrySelect
                value={phoneCountry}
                onChange={(c) => {
                  setPhoneCountry(c);
                  setPhone(undefined);
                }}
              />
              <span className="h-5 w-px shrink-0 bg-line" />
              <PhoneInput
                country={phoneCountry}
                value={phone}
                onChange={setPhone}
                placeholder="06 …"
                className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
              />
            </div>
            <p className="mt-1.5 pl-0.5 text-[12px] leading-[1.4] text-faint">
              {t.auth.accountPhoneNote}
            </p>
          </div>
        )}

        <label className="mt-7 flex cursor-pointer items-start gap-[12px] rounded-[16px] border border-line bg-elev p-4">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-[3px] h-[20px] w-[20px] shrink-0 accent-acc"
          />
          <span className="text-[13.5px] leading-[1.5] text-text">
            {t.auth.consentPre}
            <a href={TERMS_URL} target="_blank" rel="noreferrer" className="font-semibold text-acc underline">
              {t.auth.consentTerms}
            </a>
            {t.auth.consentMid}
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="font-semibold text-acc underline">
              {t.auth.consentPrivacy}
            </a>
            {t.auth.consentPost}
          </span>
        </label>

        {error && <div className="mt-3 text-[13.5px] leading-[1.45] text-[#ff9b9b]">{error}</div>}

        <Btn
          kind="primary"
          full
          icon="arrowR"
          onClick={submit}
          disabled={!canSubmit}
          className={`mt-6 ${agreed && detailsOk ? '' : 'opacity-[0.45]'}`}
        >
          {pending
            ? t.auth.consentBusy
            : needsDetails
              ? t.auth.accountSubmit
              : t.auth.consentSubmit}
        </Btn>
      </div>
    </div>
  );
}
