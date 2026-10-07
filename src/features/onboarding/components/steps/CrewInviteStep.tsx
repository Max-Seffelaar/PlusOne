'use client';

/** Before company setup (z8uq9m2yvp): a person with no company yet but an open
 *  crew invite accepts it here. Crew invites are never accepted at login (review
 *  round 2), and the Home banner is out of reach for someone the /app layout
 *  sends to onboarding, so this is their way in. Accepting gives them their
 *  event; the page then re-reads the onboarding state and sends them to /app.
 *  Setting up their own company stays one tap away, never forced. */
import { type JSX, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmt, t } from '@/lib/i18n';
import { AUTH_GRADIENT } from '@/lib/po/theme';
import { Icon } from '@/components/po/icon';
import { Btn } from '@/components/po/kit';
import { acceptInvitesAction } from '@/features/auth/invite-actions';

export function CrewInviteStep({ invites, onSkip }: { invites: string[]; onSkip: () => void }): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const c = t.onboarding.crewInvite;

  const accept = (): void => {
    setError(false);
    startTransition(async () => {
      const res = await acceptInvitesAction();
      if (!res.ok) {
        setError(true);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div
      className="flex h-[100dvh] flex-col items-center justify-center overflow-y-auto px-6 py-10"
      style={{ background: AUTH_GRADIENT }}
    >
      <div className="w-full max-w-[460px]">
        <span className="mb-6 inline-flex items-center gap-[7px] rounded-full bg-acc-dim px-3 py-[6px] font-body text-[12.5px] font-bold text-acc">
          <Icon name="mail" size={14} sw={2.4} />
          {c.badge}
        </span>
        <h1 className="m-0 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em] text-text md:text-[40px]">
          {invites.length === 1 ? c.headingOne : fmt(c.headingMany, { n: invites.length })}
        </h1>
        <p className="mt-4 text-[16px] leading-[1.5] text-dim">{c.sub}</p>

        <div className="mt-6 flex flex-col gap-[10px]">
          {invites.map((line) => (
            <div key={line} className="flex items-center gap-[14px] rounded-[16px] border border-line bg-elev p-[14px]">
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-acc text-on-acc">
                <Icon name="users" size={16} />
              </span>
              <div className="min-w-0 font-display text-[15px] font-bold text-text">{line}</div>
            </div>
          ))}
        </div>

        <Btn kind="primary" full icon="check" onClick={accept} disabled={pending} className="mt-8">
          {pending ? c.accepting : c.accept}
        </Btn>
        {error && (
          <p className="mt-2 text-[12.5px] text-red-300" role="alert">
            {c.error}
          </p>
        )}
        <Btn kind="ghost" full onClick={onSkip} className="mt-3">
          {c.ownCompany}
        </Btn>
      </div>
    </div>
  );
}
