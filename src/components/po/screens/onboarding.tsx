'use client';

/** Self-service venue-creatie (#40a/c): bedrijfsgegevens + AVG-bewaartermijn +
 *  abonnementsgegevens. Na aanmaken is de user Admin van de nieuwe venue.
 *
 *  Reused for the in-app "New venue" switcher quick-create (Meer → Wissel van
 *  venue → Nieuwe venue): submit calls the same create_venue_with_owner path as
 *  the onboarding wizard (createVenueAction), with complete=true so the venue is
 *  immediately usable, then sets it active + full-reloads (like switchToVenue). */
import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { createVenueAction, setActiveVenueAction } from '@/features/venues/actions';
import { VENUE_TYPES, type VenueType } from '@/features/venues/schemas';
import { TERMS_URL, PRIVACY_URL } from '@/lib/legal';
import { clearNavState, useNav } from '../context';
import { Icon } from '../icon';
import { Btn, Field, Label, Note, Scroll, Top } from '../kit';
import { BottomBar } from '../shell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

const TYPE_LABEL: Record<VenueType, string> = {
  club: 'Club',
  festival: 'Festival',
  bar: 'Bar',
  concertzaal: 'Concertzaal',
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
      // Drop the persisted nav-state first, else the reload restores THIS create
      // screen instead of landing the new owner on the venue's Start tab.
      const fd = new FormData();
      fd.set('venueId', res.venueId);
      await setActiveVenueAction(fd);
      clearNavState();
      window.location.assign('/app');
    });
  }

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Nieuwe venue" />
      <Scroll bottom={120}>
        <Note icon="building">
          Je maakt een nieuwe venue aan en wordt automatisch <b>Admin</b>. Je account blijft van jou — dit staat los van je andere venues (#24).
        </Note>

        <Label className="mb-2">Bedrijfsnaam</Label>
        <Field icon="building" placeholder="bv. LOFI" value={name} onChange={setName} autoFocus className="mb-[14px]" />
        <Label className="mb-2">Stad</Label>
        <Field icon="pin" placeholder="Amsterdam" value={city} onChange={setCity} className="mb-[18px]" />

        <Label className="mb-[10px]">Type venue</Label>
        <div className="mb-[18px] grid grid-cols-2 gap-[8px]">
          {VENUE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setVenueType(t)}
              className={cn(
                'rounded-[12px] border py-[12px] font-display text-[14px] font-bold',
                press,
                venueType === t ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim'
              )}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <Label className="mb-2">KVK-nummer (optioneel)</Label>
        <Field icon="note" placeholder="12345678" value={kvk} onChange={setKvk} inputMode="numeric" maxLength={8} className="mb-[18px]" />

        <Label className="mb-[10px]">AVG-bewaartermijn</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev p-4">
          <div className="mb-[14px] text-[13.5px] leading-[1.5] text-dim">Gastdata wordt na deze termijn automatisch geanonimiseerd tot “Gast #X” (#29). Standaard 12 maanden, minimaal 1.</div>
          <div className="flex gap-[7px]">
            {['6', '12', '24'].map((m) => (
              <button key={m} type="button" onClick={() => setRetention(m)} className={cn('flex-1 rounded-[11px] border py-[11px] font-display text-[14px] font-bold', press, retention === m ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim')}>
                {m} mnd
              </button>
            ))}
          </div>
        </div>

        <Label className="mb-[10px]">Abonnement</Label>
        <div className="mb-3 flex gap-[11px] rounded-[18px] bg-acc-dim p-4">
          <span className="mt-px shrink-0 text-acc">
            <Icon name="spark" size={17} />
          </span>
          <div className="text-[12.5px] leading-[1.45] text-text">
            Elke venue krijgt een eigen abonnement; deze start in <b>onboarding</b>. Laat je facturatiegegevens achter — je rondt de betaling later af. Pilots kunnen op <b>comped</b> draaien (#32/#40).
          </div>
        </div>
        <Label className="mb-2">Factuur-e-mail</Label>
        <Field icon="mail" placeholder="facturen@venue.nl" value={billingEmail} onChange={setBillingEmail} inputMode="email" className="mb-[14px]" />
        <Label className="mb-2">BTW-nummer (optioneel)</Label>
        <Field icon="card" placeholder="NL000000000B00" value={vat} onChange={setVat} className="mb-1.5" />
        <div className="pl-0.5 text-[12px] leading-[1.4] text-faint">We bewaren nooit zelf je IBAN of kaartgegevens — dat regelt de betaalprovider (SEPA-incasso / iDEAL).</div>

        <label className="mt-[18px] flex cursor-pointer items-start gap-[11px] rounded-[16px] border border-line bg-elev p-4">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-[2px] h-[19px] w-[19px] shrink-0 accent-acc" />
          <span className="text-[13px] leading-[1.5] text-text">
            Ik ga akkoord met de{' '}
            <a href={TERMS_URL} target="_blank" rel="noreferrer" className="font-semibold text-acc underline">Voorwaarden</a>{' '}
            en het{' '}
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="font-semibold text-acc underline">Privacybeleid</a>.
          </span>
        </label>
      </Scroll>
      <BottomBar>
        {error && <div className="mb-2.5 text-[13.5px] leading-[1.45] text-[#ff9b9b]">{error}</div>}
        <Btn kind="primary" full icon="check" onClick={submit} disabled={!ok || pending} className={ok ? '' : 'opacity-[0.45]'}>
          {pending ? 'Bezig…' : 'Venue aanmaken'}
        </Btn>
      </BottomBar>
    </div>
  );
}
