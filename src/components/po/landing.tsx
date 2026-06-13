'use client';

/** Public per-event landingpage (recreated from PLUSONE Landingpage.html, #12/#28).
 *  States: request form → "aanvraag binnen" → demo approval ("je staat op de lijst").
 *  Per #40(d) the MVP sends NO notification; the approval state is a demo only. */
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from './icon';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.985]';
const LANDING_BG = 'radial-gradient(120% 70% at 50% -8%, #211d3a 0%, #100f18 42%, #0B0B0D 100%)';

export interface LandingEvent {
  name: string;
  venue: string;
  city: string;
  date: string;
  time: string;
  line: string;
  closes: string;
}

export const DEMO_EVENT: LandingEvent = {
  name: 'FRENZY',
  venue: 'De Marktkantine',
  city: 'Amsterdam',
  date: 'za 14 dec',
  time: '23:00',
  line: 'Marcel Dettmann · Anetha · ENA',
  closes: 'za 14 dec · 22:00',
};

function LField({
  icon,
  label,
  value,
  set,
  placeholder,
  type = 'text',
  inputMode,
  optional,
  area,
}: {
  icon: IconName;
  label: string;
  value: string;
  set: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'text' | 'tel' | 'email';
  optional?: boolean;
  area?: boolean;
}): JSX.Element {
  return (
    <div className="mb-[14px]">
      <div className="mb-[7px] flex items-center justify-between">
        <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-faint">{label}</span>
        {optional && <span className="text-[11.5px] text-ghost">optioneel</span>}
      </div>
      <div className={cn('flex gap-[11px] rounded-[14px] border border-line bg-elev px-[15px] transition-colors focus-within:border-acc', area ? 'items-start py-[13px]' : 'items-center py-[14px]')}>
        <span className={cn('text-faint', area && 'mt-0.5')}>
          <Icon name={icon} size={19} />
        </span>
        {area ? (
          <textarea value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} rows={3} className="min-w-0 flex-1 resize-none border-none bg-transparent text-[16px] leading-[1.45] text-text outline-none placeholder:text-faint" />
        ) : (
          <input value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} type={type} inputMode={inputMode} className="min-w-0 flex-1 border-none bg-transparent text-[16px] text-text outline-none placeholder:text-faint" />
        )}
      </div>
    </div>
  );
}

function Footer(): JSX.Element {
  return (
    <div className="mt-[22px] flex items-center justify-center gap-[7px] text-center text-[12px] text-ghost">
      <div className="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-elev2 font-display text-[9px] font-extrabold tracking-[-0.03em] text-faint">+1</div>
      Gastenlijst geregeld via PLUSONE
    </div>
  );
}

function Wrap({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-[18px] pb-10 pt-7 text-text" style={{ background: LANDING_BG }}>
      <div className="po-screen-anim w-full max-w-[460px]">{children}</div>
    </div>
  );
}

export function LandingForm({ event = DEMO_EVENT }: { event?: LandingEvent }): JSX.Element {
  const [name, setName] = useState('');
  const [plus, setPlus] = useState(0);
  const [phone, setPhone] = useState('');
  const [motiv, setMotiv] = useState('');
  const [sent, setSent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const ok = name.trim().length > 1;
  const first = name.trim().split(' ')[0] || 'gast';
  const heads = 1 + plus;

  const Hero = (
    <div className="mb-[22px] text-center">
      <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-acc-dim px-[13px] py-1.5">
        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-acc font-display text-[12px] font-extrabold tracking-[-0.03em] text-on-acc">+1</div>
        <span className="font-body text-[12.5px] font-bold text-acc-soft">Gastenlijst-aanvraag</span>
      </div>
      <h1 className="m-0 font-display text-[52px] font-extrabold leading-[0.95] tracking-[-0.03em]">{event.name}</h1>
      <div className="mt-[14px] text-[14.5px] leading-[1.5] text-dim">{event.line}</div>
      <div className="mt-[18px] flex flex-wrap justify-center gap-2">
        {([['cal', event.date], ['clock', 'deur ' + event.time], ['pin', event.venue]] as [IconName, string][]).map(([d, t]) => (
          <span key={t} className="inline-flex items-center gap-[7px] rounded-[11px] border border-line bg-elev px-[13px] py-2 text-[13px] font-semibold text-dim">
            <Icon name={d} size={15} className="text-faint" />
            {t}
          </span>
        ))}
      </div>
    </div>
  );

  if (accepted) {
    return (
      <Wrap>
        {Hero}
        <div className="rounded-[24px] border border-line bg-elev px-6 py-[30px] text-center">
          <div className="mb-[18px] inline-flex items-center gap-[7px] rounded-full bg-acc-dim px-[13px] py-1.5">
            <Icon name="check2" size={15} stroke="#B5A6FF" sw={2.4} />
            <span className="text-[12.5px] font-bold text-acc-soft">Melding · goedgekeurd</span>
          </div>
          <h2 className="m-0 mb-2 font-display text-[28px] font-extrabold tracking-[-0.02em]">Je staat op de lijst!</h2>
          <p className="mx-auto mb-[22px] max-w-[320px] text-[14.5px] leading-[1.5] text-dim">
            Top nieuws, <b className="text-text">{first}</b> — de organisatie van {event.name} heeft je aanvraag goedgekeurd.
          </p>
          <div className="rounded-[16px] border border-line bg-bg p-[18px] text-left">
            <div className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.04em] text-faint">Dit heb je gekregen</div>
            <div className="flex items-center gap-[11px] border-b border-line2 pb-[13px]">
              <span className="h-3 w-3 shrink-0 rounded-full bg-acc" />
              <div className="flex-1">
                <div className="font-display text-[16px] font-bold text-text">VIP — fles op tafel</div>
                <div className="mt-px text-[12.5px] text-faint">Tier toegekend door de organisatie</div>
              </div>
            </div>
            <div className="flex items-center gap-[11px] pt-[13px]">
              <Icon name="users" size={18} className="text-faint" />
              <div className="flex-1 text-[14.5px] font-semibold text-text">
                {heads} {heads === 1 ? 'persoon' : 'personen'}
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-acc-dim px-[11px] py-[5px] font-body text-[12.5px] font-bold text-acc">
                <Icon name="check2" size={12} stroke="#B5A6FF" sw={2.4} />
                Gratis aan de deur
              </span>
            </div>
          </div>
          <div className="mt-[14px] flex items-start gap-[9px] rounded-[14px] bg-acc-dim px-4 py-[14px] text-left">
            <Icon name="shield" size={17} stroke="#B5A6FF" />
            <span className="text-[12.5px] leading-[1.45] text-text">Check-in loopt op naam aan de deur — je hoeft niets te laten zien. Tot {event.date.replace('za ', '')}!</span>
          </div>
        </div>
        <Footer />
      </Wrap>
    );
  }

  if (sent) {
    return (
      <Wrap>
        {Hero}
        <div className="rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
          <div className="mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px] bg-acc">
            <Icon name="check2" size={32} stroke="#16132B" sw={2.4} />
          </div>
          <h2 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">Je aanvraag is binnen</h2>
          <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">
            Bedankt, <b className="text-text">{first}</b>
            {plus > 0 && <span> (+{plus})</span>}. De organisatie van {event.name} beoordeelt je aanvraag.
          </p>
          <div className="mt-[22px] flex items-center gap-[11px] rounded-[14px] bg-acc-dim px-4 py-[14px] text-left">
            <Icon name="shield" size={18} stroke="#B5A6FF" />
            <span className="text-[13px] leading-[1.4] text-text">Bewaar deze pagina niet als bewijs — check-in loopt op naam aan de deur.</span>
          </div>
          <button type="button" onClick={() => setAccepted(true)} className={cn('mt-[18px] inline-flex w-full items-center justify-center gap-2 rounded-[13px] border border-line bg-transparent px-3 py-3 font-display text-[14.5px] font-bold text-dim', press)}>
            <Icon name="check2" size={15} />
            Demo: bekijk de goedkeuringsmelding
          </button>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setName('');
              setPlus(0);
              setPhone('');
              setMotiv('');
            }}
            className={cn('mt-[10px] cursor-pointer border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}
          >
            Nog iemand aanmelden
          </button>
        </div>
        <Footer />
      </Wrap>
    );
  }

  const stepBtn = cn('flex h-[48px] w-[48px] items-center justify-center rounded-[14px] border border-line bg-elev2 text-text', press);
  return (
    <Wrap>
      {Hero}
      <div className="rounded-[24px] border border-line bg-elev px-[22px] py-6">
        <div className="mb-1 font-display text-[21px] font-extrabold tracking-[-0.01em]">Zet jezelf op de lijst</div>
        <div className="mb-[14px] text-[13.5px] leading-[1.45] text-faint">Vul je naam in. De rest helpt de organisatie je sneller te herkennen aan de deur.</div>
        <div className="mb-[18px] inline-flex items-center gap-2 rounded-[11px] bg-acc-dim px-3 py-2">
          <Icon name="clock" size={14} stroke="#B5A6FF" />
          <span className="text-[12.5px] font-semibold text-text">Aanmelden kan t/m {event.closes}</span>
        </div>

        <LField icon="user" label="Naam" value={name} set={setName} placeholder="Voor- en achternaam" />

        <div className="mb-[14px]">
          <div className="mb-[7px] flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-faint">Hoeveel kom je</span>
            <span className="text-[11.5px] text-ghost">incl. jezelf</span>
          </div>
          <div className="flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[9px]">
            <button type="button" onClick={() => setPlus(Math.max(0, plus - 1))} className={stepBtn} aria-label="Minder">
              <Icon name="minus" size={20} sw={2.4} />
            </button>
            <div className="text-center">
              <div className="font-display text-[26px] font-extrabold leading-none">{heads}</div>
              <div className="mt-0.5 text-[11px] text-dim">{heads === 1 ? 'persoon' : 'personen'}</div>
            </div>
            <button type="button" onClick={() => setPlus(plus + 1)} className={stepBtn} aria-label="Meer">
              <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
            </button>
          </div>
        </div>

        <LField icon="phone" label="Telefoon" value={phone} set={setPhone} placeholder="06 ········" type="tel" inputMode="tel" optional />
        <LField icon="note" label="Bericht" value={motiv} set={setMotiv} placeholder="bv. vriend van de DJ, verjaardag…" optional area />

        <button
          type="button"
          onClick={() => ok && setSent(true)}
          disabled={!ok}
          className={cn('mt-1.5 inline-flex w-full items-center justify-center gap-[9px] rounded-[14px] border-none bg-acc px-4 py-4 font-display text-[16px] font-bold tracking-[-0.01em] text-on-acc', press, ok ? 'cursor-pointer' : 'cursor-not-allowed opacity-[0.45]')}
        >
          <Icon name="check2" size={19} sw={2.2} />
          Verstuur aanvraag
        </button>
        <div className="mt-[14px] flex items-start gap-2">
          <Icon name="shield" size={14} className="text-ghost" />
          <span className="text-[11.5px] leading-[1.45] text-ghost">Je gegevens gaan alleen naar de organisatie van dit event en worden na het bewaartermijn automatisch geanonimiseerd. Geen account nodig.</span>
        </div>
      </div>
      <Footer />
    </Wrap>
  );
}
