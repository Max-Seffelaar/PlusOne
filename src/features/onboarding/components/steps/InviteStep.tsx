'use client';

/** Before company setup (z8uq9m2yvp): a person with no company yet but an open
 *  invite, team or crew, decides on each one here. Nothing is accepted at login
 *  (invites are never auto-accepted), and the Home banner is out of reach for
 *  someone the /app layout sends to onboarding, so this is their way in. Accept
 *  gives them that company or event; the page then re-reads the onboarding state
 *  and sends them to /app. Decline closes that one invite and tells them so
 *  (the inviter and they are also mailed). Setting up their own company stays one
 *  tap away, never forced. */
import { type JSX, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { fmt, t } from '@/lib/i18n';
import { AUTH_GRADIENT } from '@/lib/po/theme';
import { Icon } from '@/components/po/icon';
import { Btn } from '@/components/po/kit';
import { acceptInviteAction, declineInviteAction } from '@/features/auth/invite-actions';

export interface OnboardingInvite {
  id: string;
  /** One line: "Club Vesper (Staff)" or "Crew · Vesper Fridays at Club Vesper". */
  label: string;
  company: string;
}

export function InviteStep({ invites, onSkip }: { invites: OnboardingInvite[]; onSkip: () => void }): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(invites);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declinedFrom, setDeclinedFrom] = useState<string | null>(null);
  const c = t.onboarding.invites;

  const accept = (invite: OnboardingInvite): void => {
    setError(null);
    setDeclinedFrom(null);
    setBusyId(invite.id);
    startTransition(async () => {
      const res = await acceptInviteAction(invite.id);
      if (!res.ok) {
        setError(c.error);
        return;
      }
      router.refresh();
    });
  };

  const decline = (invite: OnboardingInvite): void => {
    setError(null);
    setDeclinedFrom(null);
    setBusyId(invite.id);
    startTransition(async () => {
      const res = await declineInviteAction(invite.id);
      if (!res.ok) {
        setError(c.declineError);
        return;
      }
      setOpen((list) => list.filter((i) => i.id !== invite.id));
      setDeclinedFrom(invite.company);
    });
  };

  const allDeclined = open.length === 0;

  return (
    <div
      className="flex h-[100dvh] flex-col items-center justify-center overflow-y-auto px-6 py-10"
      style={{ background: AUTH_GRADIENT }}
    >
      <div className="w-full max-w-[460px]">
        {!allDeclined && (
          <>
            <span className="mb-6 inline-flex items-center gap-[7px] rounded-full bg-acc-dim px-3 py-[6px] font-body text-[12.5px] font-bold text-acc">
              <Icon name="mail" size={14} sw={2.4} />
              {c.badge}
            </span>
            <h1 className="m-0 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em] text-text md:text-[40px]">
              {open.length === 1 ? c.headingOne : fmt(c.headingMany, { n: open.length })}
            </h1>
            <p className="mt-4 text-[16px] leading-[1.5] text-dim">{c.sub}</p>

            <div className="mt-6 flex flex-col gap-[10px]">
              {open.map((invite) => (
                <div key={invite.id} className="rounded-[16px] border border-line bg-elev p-[14px]">
                  <div className="flex items-center gap-[14px]">
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-acc text-on-acc">
                      <Icon name="users" size={16} />
                    </span>
                    <div className="min-w-0 font-display text-[15px] font-bold text-text">{invite.label}</div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Btn kind="ghost" sm full disabled={pending} onClick={() => decline(invite)}>
                      {pending && busyId === invite.id ? c.declining : c.decline}
                    </Btn>
                    <Btn kind="primary" sm full icon="check" disabled={pending} onClick={() => accept(invite)}>
                      {pending && busyId === invite.id ? c.accepting : c.accept}
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {declinedFrom && (
          <p className={allDeclined ? 'text-[16px] leading-[1.5] text-text' : 'mt-4 text-[13px] text-dim'} role="status">
            {fmt(t.shared.invites.declinedNotice, { company: declinedFrom })}
          </p>
        )}
        {error && (
          <p className="mt-2 text-[12.5px] text-red-300" role="alert">
            {error}
          </p>
        )}

        <Btn kind={allDeclined ? 'primary' : 'ghost'} full onClick={onSkip} disabled={pending} className="mt-6">
          {allDeclined ? c.ownCompanyAfter : c.ownCompany}
        </Btn>
      </div>
    </div>
  );
}
