'use client';

/** Self-service venue-creatie (#40a/c): bedrijfsgegevens + AVG-bewaartermijn +
 *  abonnementsgegevens. Na aanmaken is de user Admin van de nieuwe venue. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
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
      <Top onBack={nav.back} title="Nieuwe venue" />
      <Scroll bottom={120}>
        <Note icon="building">
          Je maakt een nieuwe venue aan en wordt automatisch <b>Admin</b>. Je account blijft van jou — dit staat los van je andere venues (#24).
        </Note>

        <Label className="mb-2">Bedrijfsnaam</Label>
        <Field icon="building" placeholder="bv. LOFI" value={name} onChange={setName} autoFocus className="mb-[14px]" />
        <Label className="mb-2">Stad</Label>
        <Field icon="pin" placeholder="Amsterdam" value={city} onChange={setCity} className="mb-[14px]" />
        <Label className="mb-2">KVK / BTW (optioneel)</Label>
        <Field icon="note" placeholder="NL••• ••• B••" value={kvk} onChange={setKvk} className="mb-[18px]" />

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
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => nav.back()} className={ok ? '' : 'opacity-[0.45]'}>
          Venue aanmaken
        </Btn>
      </BottomBar>
    </div>
  );
}
