'use client';

/** Self-service venue-creatie (#40a/c): bedrijfsgegevens + AVG-bewaartermijn +
 *  abonnementsgegevens. Na aanmaken is de user Admin van de nieuwe venue. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Btn, Field, Label, Note, Scroll, Top } from '../kit';
import { BottomBar } from '../shell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

export function VenueCreate(): JSX.Element {
  const nav = useNav();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [kvk, setKvk] = useState('');
  const [retention, setRetention] = useState('12');
  const [billingEmail, setBillingEmail] = useState('');
  const [vat, setVat] = useState('');
  const ok = name.trim().length > 1;
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.onboarding.venueCreate.title} />
      <Scroll bottom={120}>
        <Note icon="building">
          {t.onboarding.venueCreate.introPre}
          <b>{t.onboarding.venueCreate.introBold}</b>
          {t.onboarding.venueCreate.introPost}
        </Note>

        <Label className="mb-2">{t.onboarding.venueCreate.companyNameLabel}</Label>
        <Field icon="building" placeholder={t.onboarding.venueCreate.companyNamePlaceholder} value={name} onChange={setName} autoFocus className="mb-[14px]" />
        <Label className="mb-2">{t.onboarding.venueCreate.cityLabel}</Label>
        <Field icon="pin" placeholder={t.onboarding.venueCreate.cityPlaceholder} value={city} onChange={setCity} className="mb-[14px]" />
        <Label className="mb-2">{t.onboarding.venueCreate.kvkVatLabel}</Label>
        <Field icon="note" placeholder={t.onboarding.venueCreate.kvkVatPlaceholder} value={kvk} onChange={setKvk} className="mb-[18px]" />

        <Label className="mb-[10px]">{t.onboarding.venueCreate.retentionLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev p-4">
          <div className="mb-[14px] text-[13.5px] leading-[1.5] text-dim">{t.onboarding.venueCreate.retentionNote}</div>
          <div className="flex gap-[7px]">
            {['6', '12', '24'].map((m) => (
              <button key={m} type="button" onClick={() => setRetention(m)} className={cn('flex-1 rounded-[11px] border py-[11px] font-display text-[14px] font-bold', press, retention === m ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim')}>
                {fmt(t.onboarding.venueCreate.retentionMonths, { n: m })}
              </button>
            ))}
          </div>
        </div>

        <Label className="mb-[10px]">{t.onboarding.venueCreate.billingLabel}</Label>
        <div className="mb-3 flex gap-[11px] rounded-[18px] bg-acc-dim p-4">
          <span className="mt-px shrink-0 text-acc">
            <Icon name="spark" size={17} />
          </span>
          <div className="text-[12.5px] leading-[1.45] text-text">
            {t.onboarding.venueCreate.billingNotePre}
            <b>{t.onboarding.venueCreate.billingNoteBold1}</b>
            {t.onboarding.venueCreate.billingNoteMid}
            <b>{t.onboarding.venueCreate.billingNoteBold2}</b>
            {t.onboarding.venueCreate.billingNotePost}
          </div>
        </div>
        <Label className="mb-2">{t.onboarding.venueCreate.billingEmailLabel}</Label>
        <Field icon="mail" placeholder={t.onboarding.venueCreate.billingEmailPlaceholder} value={billingEmail} onChange={setBillingEmail} inputMode="email" className="mb-[14px]" />
        <Label className="mb-2">{t.onboarding.venueCreate.vatLabel}</Label>
        <Field icon="card" placeholder={t.onboarding.venueCreate.vatPlaceholder} value={vat} onChange={setVat} className="mb-1.5" />
        <div className="pl-0.5 text-[12px] leading-[1.4] text-faint">{t.onboarding.venueCreate.paymentNote}</div>
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => nav.back()} className={ok ? '' : 'opacity-[0.45]'}>
          {t.onboarding.venueCreate.submit}
        </Btn>
      </BottomBar>
    </div>
  );
}
