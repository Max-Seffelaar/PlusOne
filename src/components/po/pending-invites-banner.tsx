'use client';

/** Incoming-invite banner for po (#24) — shown on the home/start screen when the
 *  signed-in user has open invites to ANOTHER venue (the "invited while already
 *  logged in" case the desktop PendingInvitesBanner handled; first-login invites
 *  auto-accept in /auth/callback). Accepting changes memberships, which are
 *  resolved server-side in /app, so we router.refresh() afterwards to re-resolve
 *  identity + the venue switcher. Renders nothing when there are no invites. */
import { useRouter } from 'next/navigation';
import { usePoMyPendingInvites } from '@/features/po/hooks';
import { usePoAcceptInvites } from '@/features/po/mutations';
import { Icon } from './icon';
import { Btn } from './kit';

export function PendingInvitesBanner(): JSX.Element | null {
  const router = useRouter();
  const invites = usePoMyPendingInvites();
  const accept = usePoAcceptInvites();
  const list = invites.data ?? [];
  if (list.length === 0) return null;

  return (
    <div className="rounded-[18px] border border-acc-dim bg-acc-dim p-4">
      <div className="mb-1 flex items-center gap-[10px]">
        <Icon name="mail" size={20} stroke="#B5A6FF" />
        <span className="font-display text-[15px] font-bold text-text">
          {list.length === 1
            ? 'Je hebt een openstaande uitnodiging'
            : `Je hebt ${list.length} openstaande uitnodigingen`}
        </span>
      </div>
      <div className="mb-3 text-[13px] leading-[1.5] text-dim">
        {list.map((iv) => `${iv.venueName} (${iv.rolesLabel})`).join(' · ')}
      </div>
      <Btn
        kind="primary"
        full
        icon="check"
        disabled={accept.isPending}
        onClick={() => accept.mutate(undefined, { onSuccess: () => router.refresh() })}
      >
        {accept.isPending
          ? 'Accepteren…'
          : list.length === 1
            ? 'Uitnodiging accepteren'
            : 'Uitnodigingen accepteren'}
      </Btn>
      {accept.isError && (
        <p className="mt-2 text-[12.5px] text-red-300" role="alert">
          Kon de uitnodiging niet accepteren. Probeer het opnieuw.
        </p>
      )}
    </div>
  );
}
