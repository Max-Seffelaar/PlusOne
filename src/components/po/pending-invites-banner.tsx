'use client';

/** Incoming-invite banner for po (#24) — shown on the home/start screen when the
 *  signed-in user has open invites, team or crew (z8uq9m2yvp). NOTHING is
 *  accepted at login: every invite waits here, each with its own Accept and
 *  Decline, until the person taps. The company sees nothing of them before that.
 *  Accepting changes memberships, which are resolved server-side in /app, so we
 *  router.refresh() afterwards to re-resolve identity + the venue switcher.
 *  Declining closes the invite and confirms in place (the inviter and the
 *  decliner are also mailed). Renders nothing when there is nothing to show. */
import { type JSX, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, fmt } from '@/lib/i18n';
import { usePoMyPendingInvites } from '@/features/po/hooks';
import { usePoAcceptInvite, usePoDeclineInvite } from '@/features/po/mutations';
import { Icon } from './icon';
import { Btn } from './kit';

export function PendingInvitesBanner(): JSX.Element | null {
  const router = useRouter();
  const invites = usePoMyPendingInvites();
  const accept = usePoAcceptInvite();
  const decline = usePoDeclineInvite();
  const [declinedFrom, setDeclinedFrom] = useState<string | null>(null);
  const list = invites.data ?? [];
  const copy = t.shared.invites;
  if (list.length === 0 && !declinedFrom) return null;

  const busy = accept.isPending || decline.isPending;
  const failed = accept.isError ? copy.error : decline.isError ? copy.declineError : null;

  const onAccept = (id: string): void => {
    setDeclinedFrom(null);
    decline.reset();
    accept.mutate(id, { onSuccess: () => router.refresh() });
  };
  const onDecline = (id: string, company: string): void => {
    setDeclinedFrom(null);
    accept.reset();
    decline.mutate(id, { onSuccess: () => setDeclinedFrom(company) });
  };

  return (
    <div className="rounded-[18px] border border-acc-dim bg-acc-dim p-4">
      {list.length > 0 && (
        <>
          <div className="mb-1 flex items-center gap-[10px]">
            <Icon name="mail" size={20} stroke="#B5A6FF" />
            <span className="font-display text-[15px] font-bold text-text">
              {list.length === 1 ? copy.headingOne : fmt(copy.headingMany, { n: list.length })}
            </span>
          </div>
          <p className="mb-3 text-[13px] leading-[1.5] text-dim">{copy.note}</p>
          <div className="flex flex-col gap-[10px]">
            {list.map((iv) => (
              <div key={iv.id} className="rounded-[14px] border border-line bg-elev p-3">
                <div className="mb-3 text-[14px] leading-[1.4] text-text">{iv.label}</div>
                <div className="flex gap-2">
                  <Btn kind="ghost" sm full disabled={busy} onClick={() => onDecline(iv.id, iv.venueName)}>
                    {decline.isPending && decline.variables === iv.id ? copy.declining : copy.decline}
                  </Btn>
                  <Btn kind="primary" sm full icon="check" disabled={busy} onClick={() => onAccept(iv.id)}>
                    {accept.isPending && accept.variables === iv.id ? copy.accepting : copy.accept}
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {declinedFrom && (
        <p className={list.length > 0 ? 'mt-3 text-[13px] text-dim' : 'text-[13px] text-dim'} role="status">
          {fmt(copy.declinedNotice, { company: declinedFrom })}
        </p>
      )}
      {failed && (
        <p className="mt-2 text-[12.5px] text-red-300" role="alert">
          {failed}
        </p>
      )}
    </div>
  );
}
