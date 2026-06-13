import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getVenueMembers, getPendingInvitesForVenue } from '@/lib/auth/memberships';
import { getDashboardVenues, resolveActiveVenueId } from '@/lib/auth/active-venue';
import { canGrantRoles } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { InviteForm } from '@/features/auth/components/InviteForm';
import { RevokeInviteButton } from '@/features/auth/components/RevokeInviteButton';
import { RoleBadges } from '@/features/auth/components/RoleBadges';
import { MemberRolesEditor } from '@/features/venues/components/MemberRolesEditor';
import { RemoveMemberButton } from '@/features/venues/components/RemoveMemberButton';

export const metadata: Metadata = { title: 'Team — PLUSONE' };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string }>;
}): Promise<JSX.Element> {
  const ctx = await requireAppAccess('/admin/team');
  const { venue: venueParam } = await searchParams;

  const dashboardVenues = await getDashboardVenues();
  if (dashboardVenues.length === 0) {
    return (
      <div className="card mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Team</h1>
        <p className="text-dim mt-2">Je hebt geen toegang tot teambeheer voor een venue.</p>
      </div>
    );
  }

  const activeId = await resolveActiveVenueId(dashboardVenues, venueParam);
  const active = dashboardVenues.find((m) => m.venueId === activeId) ?? dashboardVenues[0];
  const caps = venueCapabilities(active.roles);
  const callerIsAdmin = active.roles.includes('admin');

  const [members, pending] = await Promise.all([
    getVenueMembers(active.venueId),
    getPendingInvitesForVenue(active.venueId),
  ]);
  const adminCount = members.filter((m) => m.roles.includes('admin')).length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Team</h1>
        <p className="text-dim mt-1 text-sm">
          Gebruikers en uitnodigingen voor <span className="text-text">{active.venueName}</span>
          {!caps.manageTeam && <span className="text-faint"> · alleen-lezen</span>}.
        </p>
      </header>

      {/* Inviting is a role grant → AAL2 (RLS). Managers only; guide non-MFA managers. */}
      {caps.manageTeam &&
        (ctx.isAal2 ? (
          <section className="card">
            <h2 className="font-display mb-1 text-lg font-semibold">Gebruiker uitnodigen</h2>
            <p className="text-dim mb-4 text-sm">
              De uitnodiging maakt een account aan; de eerste OTP-login activeert het. Uitnodigingen
              verlopen na 7 dagen.
            </p>
            <InviteForm venueId={active.venueId} callerIsAdmin={callerIsAdmin} />
          </section>
        ) : (
          <section className="border-acc-dim bg-acc-dim rounded-card border p-4 text-sm">
            <p className="text-text font-semibold">MFA vereist om gebruikers te beheren</p>
            <p className="text-dim mt-1">
              Het uitnodigen en wijzigen van rollen vereist een MFA-geverifieerde sessie.{' '}
              <Link
                href={ctx.hasVerifiedTotp ? '/mfa/verify?next=/admin/team' : '/mfa/enroll?next=/admin/team'}
                className="text-acc-soft underline"
              >
                {ctx.hasVerifiedTotp ? 'Verifieer met je authenticator' : 'Stel MFA in'}
              </Link>
              .
            </p>
          </section>
        ))}

      <section className="flex flex-col gap-3">
        <h2 className="label">Leden ({members.length})</h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => {
            // canGrantRoles(callerRoles, member.roles) mirrors the RLS USING
            // clause: a user_manager cannot touch an admin membership at all.
            const canManageThisMember =
              caps.manageTeam && ctx.isAal2 && canGrantRoles(active.roles, member.roles);
            const isLastAdmin = member.roles.includes('admin') && adminCount === 1;

            return (
              <li key={member.userId} className="card flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">{member.fullName}</p>
                    <p className="text-faint text-sm">{member.email}</p>
                  </div>
                  <RoleBadges roles={member.roles} />
                </div>

                {canManageThisMember && (
                  <div className="border-line2 flex flex-wrap items-center gap-2 border-t pt-3">
                    <MemberRolesEditor
                      venueId={active.venueId}
                      userId={member.userId}
                      memberName={member.fullName}
                      currentRoles={member.roles}
                      callerIsAdmin={callerIsAdmin}
                    />
                    <RemoveMemberButton
                      venueId={active.venueId}
                      userId={member.userId}
                      memberName={member.fullName}
                      venueName={active.venueName}
                      disabledReason={
                        isLastAdmin
                          ? 'Dit is de laatste beheerder. Maak eerst iemand anders beheerder.'
                          : undefined
                      }
                    />
                  </div>
                )}

                {caps.manageTeam && !ctx.isAal2 && (
                  <p className="border-line2 text-faint border-t pt-3 text-xs">
                    Verifieer met MFA om rollen te wijzigen of dit lid te verwijderen.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {pending.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="label">Openstaande uitnodigingen ({pending.length})</h2>
          <ul className="flex flex-col gap-2">
            {pending.map((invite) => (
              <li
                key={invite.id}
                className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold">{invite.email}</p>
                  <p className="text-faint text-sm">
                    Verloopt {new Date(invite.expiresAt).toLocaleDateString('nl-NL')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <RoleBadges roles={invite.roles} />
                  {caps.manageTeam && ctx.isAal2 && <RevokeInviteButton inviteId={invite.id} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
