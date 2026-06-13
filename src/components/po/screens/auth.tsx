'use client';

/** Auth flow (wireframe fidelity): Welcome → Login → OTP → MFA, plus Invite (#20). */
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { AUTH_GRADIENT } from '@/lib/po/theme';
import type { AuthNav } from '../context';
import { Icon } from '../icon';
import { Btn, Field, Label, MiniChip, Note, RoleChip } from '../kit';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const backBtnCls = cn('flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-line bg-elev text-text', press);

function BackBtn({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className={backBtnCls} aria-label="Terug">
      <Icon name="back" size={20} />
    </button>
  );
}

export function Welcome({ auth }: { auth: AuthNav }): JSX.Element {
  return (
    <div className="flex h-full flex-col px-[26px] pb-[30px]" style={{ background: AUTH_GRADIENT }}>
      <div className="flex flex-1 flex-col items-start justify-center">
        <div className="mb-[26px] flex h-16 w-16 items-center justify-center rounded-[20px] bg-acc">
          <span className="font-display text-[30px] font-extrabold tracking-[-0.04em] text-on-acc">+1</span>
        </div>
        <h1 className="m-0 font-display text-[52px] font-extrabold leading-[0.95] tracking-[-0.03em] text-text">
          plus
          <br />
          one
        </h1>
        <p className="mt-5 max-w-[260px] text-[17px] leading-[1.5] text-dim">
          Zet ze op de lijst.
          <br />
          <span className="text-text">Wij doen de deur.</span>
        </p>
      </div>
      <div className="flex flex-col gap-[11px]">
        <Btn kind="primary" full onClick={() => auth.go('login')}>
          Inloggen
        </Btn>
        <Btn kind="dark" full onClick={() => auth.go('invite')}>
          Ik heb een uitnodiging
        </Btn>
        <div className="mt-1.5 text-center font-body text-[12px] text-ghost">gastenlijst by Mainstage HQ</div>
      </div>
    </div>
  );
}

export function Login({ auth }: { auth: AuthNav }): JSX.Element {
  const [email, setEmail] = useState('');
  const ok = /.+@.+\..+/.test(email);
  return (
    <div className="flex h-full flex-col px-[26px] pb-[28px]" style={{ background: AUTH_GRADIENT }}>
      <div className="flex-none pt-[14px]">
        <BackBtn onClick={() => auth.go('welcome')} />
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <h1 className="mb-2 mt-0 font-display text-[32px] font-extrabold tracking-[-0.02em] text-text">Inloggen</h1>
        <p className="mb-6 mt-0 text-[15px] leading-[1.5] text-dim">We sturen een code van 6 cijfers naar je mail. Geen wachtwoorden — nooit.</p>
        <Label className="mb-2">E-mailadres</Label>
        <Field icon="contact" placeholder="jij@venue.nl" value={email} onChange={setEmail} inputMode="email" autoFocus />
        <div className="h-4" />
        <Btn kind="primary" full icon="arrowR" onClick={() => ok && auth.go('otp', { email })} className={ok ? '' : 'opacity-50'}>
          Stuur inlogcode
        </Btn>
        <Note icon="shield">Alleen accounts op uitnodiging. Bestaat je adres niet, dan zeggen we dat bewust niet — anti-enumeratie.</Note>
      </div>
    </div>
  );
}

export function Otp({ auth, email }: { auth: AuthNav; email?: string }): JSX.Element {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const full = code.every((c) => c !== '');
  const set = (i: number, v: string): void => {
    if (!/^\d?$/.test(v)) return;
    setCode((c) => {
      const n = [...c];
      n[i] = v;
      return n;
    });
    if (v && refs.current[i + 1]) refs.current[i + 1]?.focus();
  };
  return (
    <div className="flex h-full flex-col px-[26px] pb-[28px]">
      <div className="flex-none pt-[14px]">
        <BackBtn onClick={() => auth.go('login')} />
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <h1 className="mb-2 mt-0 font-display text-[32px] font-extrabold tracking-[-0.02em] text-text">Voer je code in</h1>
        <p className="mb-[26px] mt-0 text-[15px] leading-[1.5] text-dim">
          Gestuurd naar <span className="text-text">{email || 'jij@venue.nl'}</span>
        </p>
        <div className="mb-[22px] flex gap-[9px]">
          {code.map((c, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={c}
              inputMode="numeric"
              maxLength={1}
              autoFocus={i === 0}
              onChange={(e) => set(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !c && refs.current[i - 1]) refs.current[i - 1]?.focus();
              }}
              className={cn(
                'h-[60px] min-w-0 flex-1 rounded-[14px] text-center font-display text-[26px] font-extrabold text-text outline-none',
                c ? 'border border-transparent bg-acc-dim' : 'border border-line bg-elev',
              )}
            />
          ))}
        </div>
        <Btn kind="primary" full icon="check" onClick={() => full && auth.go('mfa')} className={full ? '' : 'opacity-50'}>
          Bevestig code
        </Btn>
        <div className="mt-4 text-center">
          <button type="button" className={cn('cursor-pointer border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
            Geen code? Opnieuw sturen (0:28)
          </button>
        </div>
      </div>
    </div>
  );
}

export function Mfa({ auth }: { auth: AuthNav }): JSX.Element {
  const [code, setCode] = useState('');
  return (
    <div className="flex h-full flex-col px-[26px] pb-[28px]">
      <div className="flex-none pt-[14px]">
        <BackBtn onClick={() => auth.go('otp')} />
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-[18px] flex h-[54px] w-[54px] items-center justify-center rounded-[16px] bg-acc-dim text-acc">
          <Icon name="shield" size={26} />
        </div>
        <h1 className="mb-2 mt-0 font-display text-[30px] font-extrabold tracking-[-0.02em] text-text">Tweestapsverificatie</h1>
        <p className="mb-[22px] mt-0 text-[15px] leading-[1.5] text-dim">
          Je bent <b className="text-text">Admin</b>. Voer de code uit je authenticator-app in.
        </p>
        <Field placeholder="6-cijferige code" value={code} onChange={(v) => /^\d{0,6}$/.test(v) && setCode(v)} inputMode="numeric" autoFocus className="mb-4" />
        <Btn kind="primary" full icon="check" onClick={() => code.length === 6 && auth.start()} className={code.length === 6 ? '' : 'opacity-50'}>
          Inloggen
        </Btn>
        <Note icon="shield">MFA is verplicht voor Admin en Finance. Quota-verhogingen, rolwijzigingen en het audit log vereisen deze stap (AAL2).</Note>
      </div>
    </div>
  );
}

export function Invite({ auth }: { auth: AuthNav }): JSX.Element {
  return (
    <div className="flex h-full flex-col px-[26px] pb-[28px]" style={{ background: AUTH_GRADIENT }}>
      <div className="flex flex-1 flex-col items-start justify-center">
        <div className="mb-[22px] flex h-14 w-14 items-center justify-center rounded-[18px] bg-acc">
          <span className="font-display text-[26px] font-extrabold tracking-[-0.04em] text-on-acc">+1</span>
        </div>
        <Label className="mb-[10px]">Uitnodiging</Label>
        <h1 className="mb-[10px] mt-0 font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.02em] text-text">Max nodigt je uit bij LOFI</h1>
        <p className="mb-[18px] mt-0 text-[15px] leading-[1.5] text-dim">
          Je krijgt de rol <span className="text-text">Host</span> met <span className="text-text">5 gastenlijst-plekken</span> per event. Je account werkt los van de venue — toegang elders blijft van jou.
        </p>
        <div className="mb-2 flex gap-[7px]">
          <RoleChip role="Crew" />
          <MiniChip>5 plekken/event</MiniChip>
        </div>
      </div>
      <div className="flex flex-col gap-[11px]">
        <Btn kind="primary" full icon="arrowR" onClick={() => auth.go('login')}>
          Uitnodiging aannemen
        </Btn>
        <Btn kind="quiet" full onClick={() => auth.go('welcome')}>
          Niet nu
        </Btn>
      </div>
    </div>
  );
}
