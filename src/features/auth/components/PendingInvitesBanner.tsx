import { getMyPendingInvites } from '@/lib/auth/memberships';
import { ROLE_LABELS } from '../roles';
import { AcceptInvitesButton } from './AcceptInvitesButton';

// Server component for the app shell: shown when the signed-in user has open
// invites addressed to their e-mail (the "invited to a second venue while
// already logged in" case — first-login acceptance happens in /auth/callback).
export async function PendingInvitesBanner(): Promise<JSX.Element | null> {
  const invites = await getMyPendingInvites();
  if (invites.length === 0) return null;

  return (
    <div className="border-acc-dim bg-acc-dim mx-auto mb-4 flex max-w-3xl flex-col gap-3 rounded-card border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <p className="text-text font-semibold">
          {invites.length === 1 ? 'You have a pending invite' : `You have ${invites.length} pending invites`}
        </p>
        <p className="text-dim mt-1">
          {invites
            .map(
              (i) =>
                `${i.venueName ?? 'Venue'} (${i.roles.map((r) => ROLE_LABELS[r]).join(', ')})`
            )
            .join(' · ')}
        </p>
      </div>
      <AcceptInvitesButton />
    </div>
  );
}
