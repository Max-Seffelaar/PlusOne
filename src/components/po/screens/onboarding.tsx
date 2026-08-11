'use client';

/** Self-service venue creation (#40a/c): company details + data retention +
 *  subscription. After creating, the user is Admin of the new venue.
 *
 *  Reused for the in-app "New venue" switcher quick-create (More → Switch venue →
 *  New venue): submit calls the same create_venue_with_owner path as the
 *  onboarding wizard (createVenueAction), with complete=true so the venue is
 *  immediately usable, then sets it active + full-reloads (like switchToVenue). */
import { type JSX, useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { createVenueAction, setActiveVenueAction } from '@/features/venues/actions';
import { VENUE_TYPES, type VenueType } from '@/features/venues/schemas';
import { TERMS_URL, PRIVACY_URL } from '@/lib/legal';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Btn, Field, Label, Note, Scroll, Top, press } from '../kit';
import { BottomBar } from '../shell';

const col = 'flex h-full flex-col';

const vc = t.onboarding.venueCreate;

const TYPE_LABEL: Record<VenueType, string> = {
  club: vc.typeClub,
  festival: vc.typeFestival,
  bar: vc.typeBar,
  concertzaal: vc.typeConcert,
};

export function VenueCreate(): JSX.Element {
  const nav = useNav();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [venueType, setVenueType] = useState<VenueType>('club');
  const [kvk, setKvk] = useState('');
  const [retention, setRetention] = useState('12');
  const [billingEmail, setBillingEmail] = useState('');
  const [vat, setVat] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ok = name.trim().length > 1 && agreed;

  function submit(): void {
    if (!ok || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createVenueAction({
        name,
        address: '',
        venueType,
        retentionMonths: Number(retention),
        city,
        kvkNumber: kvk,
        vatNumber: vat,
        financeEmail: billingEmail,
        complete: true,
        termsAccepted: agreed,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      // Make the new venue active (cookie) then full-reload so /app re-resolves
      // identity and every live query re-scopes to it (#1, mirrors switchToVenue).
      // The reload navigates to the bare /app URL (G1: the URL is the nav state,
      // so there's nothing to clear) — the new owner lands on the venue's Start tab.
      const fd = new FormData();
      fd.set('venueId', res.venueId);
      await setActiveVenueAction(fd);
      window.location.assign('/app');
    });
  }

  return (
    <div className={col}>
      <Top onBack={nav.back} title={vc.title} />
      <Scroll bottom={120}>
        <Note icon="building">
          {vc.introPre}
          <b>{vc.introBold}</b>
          {vc.introPost}
        </Note>

        <Label className="mb-2">{vc.companyNameLabel}</Label>
        <Field icon="building" placeholder={vc.companyNamePlaceholder} value={name} onChange={setName} autoFocus className="mb-[14px]" />
        <Label className="mb-2">{vc.cityLabel}</Label>
        <Field icon="pin" placeholder={vc.cityPlaceholder} value={city} onChange={setCity} className="mb-[18px]" />

        <Label className="mb-[10px]">{vc.venueTypeLabel}</Label>
        <div className="mb-[18px] grid grid-cols-2 gap-[8px]">
          {VENUE_TYPES.map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setVenueType(tp)}
              className={cn(
                'rounded-[12px] border py-[12px] font-display text-[14px] font-bold',
                press,
                venueType === tp ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim'
              )}
            >
              {TYPE_LABEL[tp]}
            </button>
          ))}
        </div>

        <Label className="mb-2">{vc.kvkLabel}</Label>
        <Field icon="note" placeholder={vc.kvkPlaceholder} value={kvk} onChange={setKvk} inputMode="numeric" maxLength={8} className="mb-[18px]" />

        <Label className="mb-[10px]">{vc.retentionLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev p-4">
          <div className="mb-[14px] text-[13.5px] leading-[1.5] text-dim">{vc.retentionNote}</div>
          <div className="flex gap-[7px]">
            {['6', '12', '24'].map((m) => (
              <button key={m} type="button" onClick={() => setRetention(m)} className={cn('flex-1 rounded-[11px] border py-[11px] font-display text-[14px] font-bold', press, retention === m ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim')}>
                {fmt(vc.retentionMonths, { n: m })}
              </button>
            ))}
          </div>
        </div>

        <Label className="mb-[10px]">{vc.billingLabel}</Label>
        <div className="mb-3 flex gap-[11px] rounded-[18px] bg-acc-dim p-4">
          <span className="mt-px shrink-0 text-acc">
            <Icon name="spark" size={17} />
          </span>
          <div className="text-[12.5px] leading-[1.45] text-text">
            {vc.billingNotePre}
            <b>{vc.billingNoteBold1}</b>
            {vc.billingNoteMid}
            <b>{vc.billingNoteBold2}</b>
            {vc.billingNotePost}
          </div>
        </div>
        <Label className="mb-2">{vc.billingEmailLabel}</Label>
        <Field icon="mail" placeholder={vc.billingEmailPlaceholder} value={billingEmail} onChange={setBillingEmail} inputMode="email" className="mb-[14px]" />
        <Label className="mb-2">{vc.vatLabel}</Label>
        <Field icon="card" placeholder={vc.vatPlaceholder} value={vat} onChange={setVat} className="mb-1.5" />
        <div className="pl-0.5 text-[12px] leading-[1.4] text-faint">{vc.paymentNote}</div>

        <label className="mt-[18px] flex cursor-pointer items-start gap-[11px] rounded-[16px] border border-line bg-elev p-4">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-[2px] h-[19px] w-[19px] shrink-0 accent-acc" />
          <span className="text-[13px] leading-[1.5] text-text">
            {vc.consentPre}
            <a href={TERMS_URL} target="_blank" rel="noreferrer" className="font-semibold text-acc underline">{vc.consentTerms}</a>
            {vc.consentMid}
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="font-semibold text-acc underline">{vc.consentPrivacy}</a>
            {vc.consentPost}
          </span>
        </label>
      </Scroll>
      <BottomBar>
        {error && <div className="mb-2.5 text-[13.5px] leading-[1.45] text-[#ff9b9b]">{error}</div>}
        <Btn kind="primary" full icon="check" onClick={submit} disabled={!ok || pending} className={ok ? '' : 'opacity-[0.45]'}>
          {pending ? vc.submitBusy : vc.submit}
        </Btn>
      </BottomBar>
    </div>
  );
}
