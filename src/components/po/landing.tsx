'use client';

/** Public per-event landingpage (recreated from PLUSONE Landingpage.html, #12/#28).
 *  Real flow: request form → "aanvraag in behandeling". Per #40(d) the MVP sends
 *  NO notification, so there is no approval state here — the requester's page
 *  ends at the confirmation. Submission goes through the rate-limited,
 *  honeypot-protected submit action; a filled honeypot still shows success.
 *  Phone is collected WITH a country code (E.164); e-mail + phone get inline
 *  validation; a marketing opt-in box records AVG consent. */
import { useState, useTransition, type ReactNode } from 'react';
import PhoneInput from 'react-phone-number-input/input';
import { isValidPhoneNumber } from 'react-phone-number-input';
import { cn } from '@/lib/utils';
import type { SubmitGuestRequestInput } from '@/features/requests/schemas';
import { isValidEmail } from '@/features/requests/validation';
import { CountrySelect, type CountryCode } from './country-select';
import { Icon, type IconName } from './icon';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.985]';
const LANDING_BG = 'radial-gradient(120% 70% at 50% -8%, #211d3a 0%, #100f18 42%, #0B0B0D 100%)';

export interface LandingEvent {
  name: string;
  date: string;
  time: string;
  /** Optional context — only present when the anon data boundary exposes it. */
  venue?: string;
  line?: string;
  closes?: string;
}

export type SubmitResult = { ok: true } | { ok: false; code: string; message: string };
export type SubmitAction = (input: SubmitGuestRequestInput) => Promise<SubmitResult>;

function FieldError({ text }: { text: string }): JSX.Element {
  return (
    <div className="mt-[6px] flex items-center gap-[6px] pl-1">
      <Icon name="warn" size={12} stroke="#B5A6FF" />
      <span className="text-[11.5px] leading-[1.35] text-acc-soft">{text}</span>
    </div>
  );
}

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
  error,
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
  error?: string | null;
}): JSX.Element {
  return (
    <div className="mb-[14px]">
      <div className="mb-[7px] flex items-center justify-between">
        <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-faint">{label}</span>
        {optional && <span className="text-[11.5px] text-ghost">optioneel</span>}
      </div>
      <div className={cn('flex gap-[11px] rounded-[14px] border bg-elev px-[15px] transition-colors focus-within:border-acc', error ? 'border-acc' : 'border-line', area ? 'items-start py-[13px]' : 'items-center py-[14px]')}>
        <span className={cn('text-faint', area && 'mt-0.5')}>
          <Icon name={icon} size={19} />
        </span>
        {area ? (
          <textarea value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} rows={3} className="min-w-0 flex-1 resize-none border-none bg-transparent text-[16px] leading-[1.45] text-text outline-none placeholder:text-faint" />
        ) : (
          <input value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} type={type} inputMode={inputMode} className="min-w-0 flex-1 border-none bg-transparent text-[16px] text-text outline-none placeholder:text-faint" />
        )}
      </div>
      {error && <FieldError text={error} />}
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

/** Shown when the slug is unknown OR the landing link is deactivated (#28) —
 *  the two are intentionally indistinguishable (no enumeration). */
export function LandingClosed(): JSX.Element {
  return (
    <Wrap>
      <div className="rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
        <div className="mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px] bg-elev2">
          <Icon name="clock" size={30} className="text-faint" />
        </div>
        <h1 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">Aanvragen gesloten</h1>
        <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">
          Deze aanmeldlink is niet (meer) actief. Vraag de organisatie om een actuele link.
        </p>
      </div>
      <Footer />
    </Wrap>
  );
}

export function LandingForm({
  event,
  slug,
  action,
}: {
  event: LandingEvent;
  slug: string;
  action: SubmitAction;
}): JSX.Element {
  const [name, setName] = useState('');
  const [plus, setPlus] = useState(0);
  const [email, setEmail] = useState('');
  // The country is chosen via the custom dropdown; the input formats for it and
  // emits an E.164 string (e.g. +31612345678) or undefined when empty.
  const [country, setCountry] = useState<CountryCode>('NL');
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [motiv, setMotiv] = useState('');
  const [marketing, setMarketing] = useState(false);
  // Honeypot — must stay empty; bots that fill it get a fake success.
  const [company, setCompany] = useState('');
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [phoneErr, setPhoneErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ok = name.trim().length > 1;
  const first = name.trim().split(' ')[0] || 'gast';
  const heads = 1 + plus;

  function submit(): void {
    if (!ok || pending) return;
    setError(null);

    // Inline validation: e-mail (if given) and phone. libphonenumber validates
    // the number per the selected country (E.164); a wrong/incomplete one is
    // caught here before submit.
    const eErr = email.trim() && !isValidEmail(email) ? 'Vul een geldig e-mailadres in.' : null;
    const pErr =
      phone && !isValidPhoneNumber(phone) ? 'Controleer je telefoonnummer (incl. landcode).' : null;
    setEmailErr(eErr);
    setPhoneErr(pErr);
    if (eErr || pErr) return;

    startTransition(async () => {
      const res = await action({
        slug,
        fullName: name.trim(),
        email: email.trim() || undefined,
        phone: phone || undefined,
        plusOnes: plus,
        motivation: motiv.trim() || undefined,
        marketingOptIn: marketing,
        company,
      });
      if (res.ok) setSent(true);
      else setError(res.message);
    });
  }

  function reset(): void {
    setSent(false);
    setName('');
    setPlus(0);
    setEmail('');
    setCountry('NL');
    setPhone(undefined);
    setMotiv('');
    setMarketing(false);
    setCompany('');
    setEmailErr(null);
    setPhoneErr(null);
    setError(null);
  }

  const Hero = (
    <div className="mb-[22px] text-center">
      <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-acc-dim px-[13px] py-1.5">
        <div className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-acc font-display text-[12px] font-extrabold tracking-[-0.03em] text-on-acc">+1</div>
        <span className="font-body text-[12.5px] font-bold text-acc-soft">Gastenlijst-aanvraag</span>
      </div>
      <h1 className="m-0 font-display text-[52px] font-extrabold leading-[0.95] tracking-[-0.03em]">{event.name}</h1>
      {event.line && <div className="mt-[14px] text-[14.5px] leading-[1.5] text-dim">{event.line}</div>}
      <div className="mt-[18px] flex flex-wrap justify-center gap-2">
        {(
          [
            ['cal', event.date],
            ['clock', 'deur ' + event.time],
            ...(event.venue ? ([['pin', event.venue]] as [IconName, string][]) : []),
          ] as [IconName, string][]
        ).map(([d, t]) => (
          <span key={t} className="inline-flex items-center gap-[7px] rounded-[11px] border border-line bg-elev px-[13px] py-2 text-[13px] font-semibold text-dim">
            <Icon name={d} size={15} className="text-faint" />
            {t}
          </span>
        ))}
      </div>
    </div>
  );

  if (sent) {
    return (
      <Wrap>
        {Hero}
        <div className="rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
          <div className="mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px] bg-acc">
            <Icon name="check2" size={32} stroke="#16132B" sw={2.4} />
          </div>
          <h2 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">Je aanvraag is in behandeling</h2>
          <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">
            Bedankt, <b className="text-text">{first}</b>
            {plus > 0 && <span> (+{plus})</span>}. De organisatie van {event.name} beoordeelt je aanvraag.
          </p>
          <div className="mt-[22px] flex items-center gap-[11px] rounded-[14px] bg-acc-dim px-4 py-[14px] text-left">
            <Icon name="shield" size={18} stroke="#B5A6FF" />
            <span className="text-[13px] leading-[1.4] text-text">Bewaar deze pagina niet als bewijs — check-in loopt op naam aan de deur.</span>
          </div>
          <button
            type="button"
            onClick={reset}
            className={cn('mt-[18px] cursor-pointer border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}
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
        {event.closes && (
          <div className="mb-[18px] inline-flex items-center gap-2 rounded-[11px] bg-acc-dim px-3 py-2">
            <Icon name="clock" size={14} stroke="#B5A6FF" />
            <span className="text-[12.5px] font-semibold text-text">Aanmelden kan t/m {event.closes}</span>
          </div>
        )}

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

        <LField
          icon="mail"
          label="E-mail"
          value={email}
          set={(v) => {
            setEmail(v);
            if (emailErr) setEmailErr(null);
          }}
          placeholder="jij@voorbeeld.nl"
          type="email"
          inputMode="email"
          optional
          error={emailErr}
        />
        <div className="mb-[14px]">
          <div className="mb-[7px] flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-faint">Telefoon</span>
            <span className="text-[11.5px] text-ghost">optioneel</span>
          </div>
          <div className={cn('flex items-center gap-[8px] rounded-[14px] border bg-elev py-[10px] pl-[9px] pr-[15px] transition-colors focus-within:border-acc', phoneErr ? 'border-acc' : 'border-line')}>
            <CountrySelect
              value={country}
              onChange={(c) => {
                if (c !== country) {
                  setCountry(c);
                  setPhone(undefined); // re-type the number for the new country
                }
                if (phoneErr) setPhoneErr(null);
              }}
            />
            <span className="h-5 w-px shrink-0 bg-line" />
            <PhoneInput
              country={country}
              value={phone}
              onChange={(v) => {
                setPhone(v);
                if (phoneErr) setPhoneErr(null);
              }}
              aria-label="Telefoonnummer"
              placeholder="6 12 34 56 78"
              className="min-w-0 flex-1 border-none bg-transparent text-[16px] text-text outline-none placeholder:text-faint"
            />
          </div>
          {phoneErr && <FieldError text={phoneErr} />}
        </div>
        <LField icon="note" label="Bericht" value={motiv} set={setMotiv} placeholder="bv. vriend van de DJ, verjaardag…" optional area />

        <button
          type="button"
          onClick={() => setMarketing(!marketing)}
          aria-pressed={marketing}
          className={cn('mb-[16px] flex w-full items-start gap-[11px] rounded-[14px] border bg-elev px-[14px] py-[13px] text-left', marketing ? 'border-acc' : 'border-line', press)}
        >
          <span className={cn('mt-px flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] border-2', marketing ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>
            {marketing && <Icon name="check" size={12} stroke="#16132B" sw={3} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[13.5px] font-bold text-text">Houd me op de hoogte</span>
            <span className="mt-px block text-[11.5px] leading-[1.4] text-faint">Ja, de organisatie mag mijn gegevens gebruiken om me te informeren over komende events.</span>
          </span>
        </button>

        {/* Honeypot: off-screen, never seen or tabbed-to by a human. */}
        <div aria-hidden className="pointer-events-none absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label>
            Bedrijf
            <input type="text" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!ok || pending}
          className={cn('mt-1.5 inline-flex w-full items-center justify-center gap-[9px] rounded-[14px] border-none bg-acc px-4 py-4 font-display text-[16px] font-bold tracking-[-0.01em] text-on-acc', press, ok && !pending ? 'cursor-pointer' : 'cursor-not-allowed opacity-[0.45]')}
        >
          <Icon name="check2" size={19} sw={2.2} />
          {pending ? 'Versturen…' : 'Verstuur aanvraag'}
        </button>
        {error && (
          <div className="mt-[12px] flex items-start gap-2 rounded-[12px] border border-line bg-bg px-3 py-[11px]">
            <Icon name="warn" size={14} stroke="#B5A6FF" className="mt-0.5" />
            <span className="text-[12.5px] leading-[1.4] text-text">{error}</span>
          </div>
        )}
        <div className="mt-[14px] flex items-start gap-2">
          <Icon name="shield" size={14} className="text-ghost" />
          <span className="text-[11.5px] leading-[1.45] text-ghost">Je gegevens gaan alleen naar de organisatie van dit event en worden na het bewaartermijn automatisch geanonimiseerd. Geen account nodig.</span>
        </div>
      </div>
      <Footer />
    </Wrap>
  );
}
