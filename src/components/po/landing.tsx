'use client';

/** Public per-event landingpage (recreated from PLUSONE Landingpage.html, #12/#28).
 *  Real flow: request form → "aanvraag in behandeling". Per #40(d) the MVP sends
 *  NO notification, so there is no approval state here — the requester's page
 *  ends at the confirmation. Submission goes through the rate-limited,
 *  honeypot-protected submit action; a filled honeypot still shows success.
 *  Phone is collected WITH a country code (E.164); e-mail + phone get inline
 *  validation; a marketing opt-in box records AVG consent. */
import { useState, useTransition, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import type { SubmitGuestRequestInput } from '@/features/requests/schemas';
import { isValidEmail } from '@/features/requests/validation';
import { CountrySelect, PhoneInput, isPhoneValid, type CountryCode } from './phone-lazy';
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
  /** Provenance of the request link ("via Jayden") — influencer/label links only. */
  via?: string;
  /** Remaining approvable headcount on a CAPPED link (0 = full); null/undefined
   *  = uncapped, nothing about capacity is disclosed (#43, Max 6-7-2026). */
  spotsLeft?: number | null;
}

export type SubmitResult =
  | { ok: true; statusToken?: string; autoApproved?: boolean }
  | { ok: false; code: string; message: string };
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
        {optional && <span className="text-[11.5px] text-ghost">{t.landing.optional}</span>}
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
      {t.landing.footer}
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

/** "Save your status link" block on the confirmation: the bearer /r/[token]
 *  URL the requester can bookmark. Clipboard is guarded (Capacitor webview /
 *  older browsers fall back to a selectable input). */
function StatusLinkBlock({ token }: { token: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== 'undefined' ? `${window.location.origin}/r/${token}` : `/r/${token}`;

  function copy(): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mt-[22px] rounded-[14px] border border-line bg-bg px-4 py-[14px] text-left">
      <div className="mb-0.5 font-display text-[13.5px] font-bold text-text">{t.landing.statusSaveTitle}</div>
      <div className="mb-[10px] text-[11.5px] leading-[1.4] text-faint">{t.landing.statusSaveSub}</div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-[10px] border border-line bg-elev px-3 py-2 text-[12px] text-dim outline-none"
        />
        <button
          type="button"
          onClick={copy}
          className={cn('shrink-0 cursor-pointer rounded-[10px] border-none bg-acc px-3 py-2 font-display text-[12.5px] font-bold text-on-acc', press)}
        >
          {copied ? t.landing.statusCopied : t.landing.statusCopy}
        </button>
      </div>
    </div>
  );
}

export type RequestStatusData = {
  status: 'pending' | 'approved' | 'denied';
  fullName: string;
  plusOnes: number;
  eventName: string;
  date: string;
};

/** The /r/[token] status page (#28: an invalid/revoked token renders the same
 *  neutral not-found — passed as data=null). Read-only; no PII beyond what the
 *  requester submitted themselves. Explicitly NOT a ticket. */
export function RequestStatus({ data }: { data: RequestStatusData | null }): JSX.Element {
  if (!data) {
    return (
      <Wrap>
        <div className="rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
          <div className="mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px] bg-elev2">
            <Icon name="warn" size={30} className="text-faint" />
          </div>
          <h1 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">{t.landing.statusNotFoundTitle}</h1>
          <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">{t.landing.statusNotFoundBody}</p>
        </div>
        <Footer />
      </Wrap>
    );
  }

  const heads = 1 + data.plusOnes;
  const view = {
    pending: {
      icon: 'clock' as IconName,
      iconBg: 'bg-elev2',
      iconStroke: undefined,
      title: t.landing.statusPendingTitle,
      body: fmt(t.landing.statusPendingBody, { event: data.eventName }),
    },
    approved: {
      icon: 'check2' as IconName,
      iconBg: 'bg-acc',
      iconStroke: '#16132B',
      title: t.landing.statusApprovedTitle,
      body: fmt(t.landing.statusApprovedBody, { event: data.eventName, date: data.date }),
    },
    denied: {
      icon: 'warn' as IconName,
      iconBg: 'bg-elev2',
      iconStroke: undefined,
      title: t.landing.statusDeniedTitle,
      body: fmt(t.landing.statusDeniedBody, { event: data.eventName }),
    },
  }[data.status];

  return (
    <Wrap>
      <div className="mb-[22px] text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-acc-dim px-[13px] py-1.5">
          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-acc font-display text-[12px] font-extrabold tracking-[-0.03em] text-on-acc">+1</div>
          <span className="font-body text-[12.5px] font-bold text-acc-soft">{fmt(t.landing.eyebrow, { event: data.eventName })}</span>
        </div>
        <h1 className="m-0 mt-4 font-display text-[40px] font-extrabold leading-[0.98] tracking-[-0.03em]">{data.eventName}</h1>
        <div className="mt-[12px] inline-flex items-center gap-[7px] rounded-[11px] border border-line bg-elev px-[13px] py-2 text-[13px] font-semibold text-dim">
          <Icon name="cal" size={15} className="text-faint" />
          {data.date}
        </div>
      </div>
      <div className="rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
        <div className={cn('mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px]', view.iconBg)}>
          <Icon name={view.icon} size={30} stroke={view.iconStroke} className={view.iconStroke ? undefined : 'text-faint'} sw={view.iconStroke ? 2.4 : undefined} />
        </div>
        <h2 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">{view.title}</h2>
        <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">
          <b className="text-text">{data.fullName}</b>
          {heads > 1 && <span> · {fmt(t.landing.statusApprovedGroup, { n: heads })}</span>}
        </p>
        <p className="mx-auto mt-[8px] max-w-[330px] text-[15px] leading-[1.55] text-dim">{view.body}</p>
        {data.status === 'approved' && (
          <div className="mt-[22px] flex items-center gap-[11px] rounded-[14px] bg-acc-dim px-4 py-[14px] text-left">
            <Icon name="shield" size={18} stroke="#B5A6FF" />
            <span className="text-[13px] leading-[1.4] text-text">{t.landing.successInfo}</span>
          </div>
        )}
      </div>
      <Footer />
    </Wrap>
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
        <h1 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">{t.landing.closedTitle}</h1>
        <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">
          {t.landing.closedBody}
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
  const [sent, setSent] = useState<{ statusToken?: string; autoApproved?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ok = name.trim().length > 1;
  const first = name.trim().split(' ')[0] || t.landing.nameFallback;
  const heads = 1 + plus;
  // Capped link (#43): the stepper never offers more heads than the link can
  // still approve. null/undefined = uncapped.
  const spotsLeft = event.spotsLeft ?? null;
  const maxPlus = spotsLeft != null ? Math.max(0, spotsLeft - 1) : Number.POSITIVE_INFINITY;
  const atCap = plus >= maxPlus;

  function submit(): void {
    if (!ok || pending) return;
    setError(null);

    // Inline validation: e-mail (if given) and phone. libphonenumber validates
    // the number per the selected country (E.164); a wrong/incomplete one is
    // caught here before submit. The phone check is async — its metadata lives in
    // the lazy phone chunk (#B4) — so it runs inside the transition.
    const eErr = email.trim() && !isValidEmail(email) ? t.landing.emailError : null;

    startTransition(async () => {
      const pErr = phone && !(await isPhoneValid(phone)) ? t.landing.phoneError : null;
      setEmailErr(eErr);
      setPhoneErr(pErr);
      if (eErr || pErr) return;

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
      if (res.ok) setSent({ statusToken: res.statusToken, autoApproved: res.autoApproved });
      else setError(res.message);
    });
  }

  function reset(): void {
    setSent(null);
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
        <span className="font-body text-[12.5px] font-bold text-acc-soft">{fmt(t.landing.eyebrow, { event: event.name })}</span>
      </div>
      <h1 className="m-0 font-display text-[52px] font-extrabold leading-[0.95] tracking-[-0.03em]">{event.name}</h1>
      {event.via && (
        <div className="mt-[10px] text-[13px] font-semibold text-faint">{fmt(t.landing.viaLine, { name: event.via })}</div>
      )}
      {event.line && <div className="mt-[14px] text-[14.5px] leading-[1.5] text-dim">{event.line}</div>}
      <div className="mt-[18px] flex flex-wrap justify-center gap-2">
        {(
          [
            ['cal', event.date],
            ['clock', fmt(t.landing.doorsAt, { time: event.time })],
            ...(event.venue ? ([['pin', event.venue]] as [IconName, string][]) : []),
          ] as [IconName, string][]
        ).map(([d, label]) => (
          <span key={label} className="inline-flex items-center gap-[7px] rounded-[11px] border border-line bg-elev px-[13px] py-2 text-[13px] font-semibold text-dim">
            <Icon name={d} size={15} className="text-faint" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );

  // A capped link with nothing left to approve takes no requests (#43): say it,
  // instead of collecting requests that can only ever stall in the queue.
  if (spotsLeft === 0 && !sent) {
    return (
      <Wrap>
        {Hero}
        <div className="rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
          <div className="mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px] bg-elev2">
            <Icon name="users" size={30} className="text-faint" />
          </div>
          <h2 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">{t.landing.fullTitle}</h2>
          <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">{t.landing.fullBody}</p>
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
          <h2 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">
            {sent.autoApproved ? t.landing.approvedTitle : t.landing.successTitle}
          </h2>
          <p className="mx-auto max-w-[330px] text-[15px] leading-[1.55] text-dim">
            {t.landing.successGreetPre}
            <b className="text-text">{first}</b>
            {plus > 0 && <span> {fmt(t.landing.successPlus, { n: plus })}</span>}
            {fmt(sent.autoApproved ? t.landing.approvedReview : t.landing.successReview, { event: event.name })}
          </p>
          {sent.statusToken && <StatusLinkBlock token={sent.statusToken} />}
          <div className="mt-[14px] flex items-center gap-[11px] rounded-[14px] bg-acc-dim px-4 py-[14px] text-left">
            <Icon name="shield" size={18} stroke="#B5A6FF" />
            <span className="text-[13px] leading-[1.4] text-text">{t.landing.successInfo}</span>
          </div>
          {/* No "add someone else" after an instant approval (Max, 6-7-2026):
              the spot is taken — repeat submissions on an auto-approve link
              invite duplicates, not friends. */}
          {!sent.autoApproved && (
            <button
              type="button"
              onClick={reset}
              className={cn('mt-[18px] cursor-pointer border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}
            >
              {t.landing.successReset}
            </button>
          )}
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
        <div className="mb-1 font-display text-[21px] font-extrabold tracking-[-0.01em]">{t.landing.formTitle}</div>
        <div className="mb-[14px] text-[13.5px] leading-[1.45] text-faint">{t.landing.formSub}</div>
        {event.closes && (
          <div className="mb-[18px] inline-flex items-center gap-2 rounded-[11px] bg-acc-dim px-3 py-2">
            <Icon name="clock" size={14} stroke="#B5A6FF" />
            <span className="text-[12.5px] font-semibold text-text">{fmt(t.landing.closesBanner, { closes: event.closes })}</span>
          </div>
        )}

        <LField icon="user" label={t.landing.nameLabel} value={name} set={setName} placeholder={t.landing.namePlaceholder} />

        <div className="mb-[14px]">
          <div className="mb-[7px] flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-faint">{t.landing.plusOnesLabel}</span>
            <span className="text-[11.5px] text-ghost">
              {spotsLeft != null
                ? spotsLeft === 1
                  ? t.landing.spotsLeftOne
                  : fmt(t.landing.spotsLeftNote, { n: spotsLeft })
                : t.landing.plusOnesNote}
            </span>
          </div>
          <div className="flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[9px]">
            <button type="button" onClick={() => setPlus(Math.max(0, plus - 1))} className={stepBtn} aria-label={t.landing.stepLessAria}>
              <Icon name="minus" size={20} sw={2.4} />
            </button>
            <div className="text-center">
              <div className="font-display text-[26px] font-extrabold leading-none">{heads}</div>
              <div className="mt-0.5 text-[11px] text-dim">{heads === 1 ? t.landing.personSingular : t.landing.personPlural}</div>
            </div>
            <button
              type="button"
              onClick={() => setPlus(Math.min(plus + 1, maxPlus))}
              disabled={atCap}
              className={cn(stepBtn, atCap && 'cursor-not-allowed opacity-40')}
              aria-label={t.landing.stepMoreAria}
            >
              <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
            </button>
          </div>
        </div>

        <LField
          icon="mail"
          label={t.landing.emailLabel}
          value={email}
          set={(v) => {
            setEmail(v);
            if (emailErr) setEmailErr(null);
          }}
          placeholder={t.landing.emailPlaceholder}
          type="email"
          inputMode="email"
          optional
          error={emailErr}
        />
        <div className="mb-[14px]">
          <div className="mb-[7px] flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-faint">{t.landing.phoneLabel}</span>
            <span className="text-[11.5px] text-ghost">{t.landing.optional}</span>
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
              aria-label={t.landing.phoneAria}
              placeholder={t.landing.phonePlaceholder}
              className="min-w-0 flex-1 border-none bg-transparent text-[16px] text-text outline-none placeholder:text-faint"
            />
          </div>
          {phoneErr && <FieldError text={phoneErr} />}
        </div>
        <LField icon="note" label={t.landing.messageLabel} value={motiv} set={setMotiv} placeholder={t.landing.messagePlaceholder} optional area />

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
            <span className="block font-display text-[13.5px] font-bold text-text">{t.landing.marketingTitle}</span>
            <span className="mt-px block text-[11.5px] leading-[1.4] text-faint">{t.landing.marketingSub}</span>
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
          {pending ? t.landing.submitting : t.landing.submit}
        </button>
        {error && (
          <div className="mt-[12px] flex items-start gap-2 rounded-[12px] border border-line bg-bg px-3 py-[11px]">
            <Icon name="warn" size={14} stroke="#B5A6FF" className="mt-0.5" />
            <span className="text-[12.5px] leading-[1.4] text-text">{error}</span>
          </div>
        )}
        <div className="mt-[14px] flex items-start gap-2">
          <Icon name="shield" size={14} className="text-ghost" />
          <span className="text-[11.5px] leading-[1.45] text-ghost">{t.landing.privacyNote}</span>
        </div>
      </div>
      <Footer />
    </Wrap>
  );
}
