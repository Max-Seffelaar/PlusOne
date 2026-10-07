'use client';

/** Incoming-invite banner for po (#24) — shown on the home/start screen when the
 *  signed-in user has open invites, team or crew (z8uq9m2yvp). NOTHING is
 *  accepted at login: every invite waits here, each with its own Accept and
 *  Decline, until the person taps. The company sees nothing of them before that.
 *  Accepting changes memberships, which are resolved server-side in /app, so we
 *  router.refresh() afterwards to re-resolve identity + the venue switcher.
 *  Declining asks first, closes the invite and confirms in place (the inviter and
 *  the decliner are also mailed). The accept/decline logic is shared with the
 *  onboarding invite step (`useInviteDecisions`). A card the server reports as no
 *  longer open disappears. Renders nothing when there is nothing to show. */
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { t, fmt } from '@/lib/i18n';
import { usePoMyPendingInvites } from '@/features/po/hooks';
import { poKeys } from '@/features/po/keys';
import { InviteActions, useInviteDecisions } from '@/features/auth/components/InviteDecisions';
import { Icon } from './icon';

export function PendingInvitesBanner(): JSX.Element | null {
  const router = useRouter();
  const qc = useQueryClient();
  const invites = usePoMyPendingInvites();
  const decisions = useInviteDecisions({
    onAccepted: () => router.refresh(),
    onChanged: () => void qc.invalidateQueries({ queryKey: poKeys.myInvites() }),
  });
  const copy = t.shared.invites;
  const list = (invites.data ?? []).filter((iv) => !decisions.isGone(iv.id));
  if (list.length === 0 && !decisions.declinedFrom && !decisions.error) return null;

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
                <InviteActions
                  invite={{ id: iv.id, company: iv.venueName }}
                  pending={decisions.pending}
                  busyKind={decisions.busy?.id === iv.id && decisions.pending ? decisions.busy.kind : null}
                  onAccept={() => decisions.accept({ id: iv.id, company: iv.venueName })}
                  onDecline={() => decisions.decline({ id: iv.id, company: iv.venueName })}
                />
              </div>
            ))}
          </div>
        </>
      )}
      {decisions.declinedFrom && (
        <p className={list.length > 0 ? 'mt-3 text-[13px] text-dim' : 'text-[13px] text-dim'} role="status">
          {fmt(copy.declinedNotice, { company: decisions.declinedFrom })}
        </p>
      )}
      {decisions.error && (
        <p className={list.length > 0 || decisions.declinedFrom ? 'mt-2 text-[12.5px] text-red-300' : 'text-[12.5px] text-red-300'} role="alert">
          {decisions.error}
        </p>
      )}
    </div>
  );
}
