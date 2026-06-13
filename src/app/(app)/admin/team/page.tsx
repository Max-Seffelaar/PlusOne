import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import {
  getMyMemberships,
  getVenueMembers,
  getPendingInvitesForVenue,
} from '@/lib/auth/memberships';
import { isManager, type VenueRole } from '@/features/auth/roles';
import { InviteForm } from '@/features/auth/components/InviteForm';
import { RevokeInviteButton } from '@/features/auth/components/RevokeInviteButton';
import { RoleBadges } from '@/features/auth/components/RoleBadges';

export const metadata: Metadata = { title: 'Team — PLUSONE' };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string }>;
}): Promise<JSX.Element> {
  const ctx = await requireAppAccess('/admin/team');
  const { venue: venueParam } = await searchParams;

  const memberships = await getMyMemberships();
  const managed = memberships.filter((m) => isManager(m.roles));

  if (managed.length === 0) {
    return (
      <div className="card mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Team</h1>
        <p className="text-dim mt-2">Je hebt geen rechten om gebruikers te beheren.</p>
      </div>
    );
  }

  const active = managed.find((m) => m.venueId === venueParam) ?? managed[0];
  const callerIsAdmin = active.roles.includes('admin' as VenueRole);

  const [members, pending] = await Promise.all([
    getVenueMembers(active.venueId),
    getPendingInvitesForVenue(active.venueId),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Team</h1>
        <p className="text-dim mt-1 text-sm">
          Gebruikers en uitnodigingen voor <span className="text-text">{active.venueName}</span>.
        </p>
      </header>

      {managed.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Venue kiezen">
          {managed.map((m) => (
            <Link
              key={m.venueId}
              href={`/admin/team?venue=${m.venueId}`}
              className={`rounded-btn border px-3 py-1.5 text-sm transition-colors ${
                m.venueId === active.venueId
                  ? 'border-acc bg-acc-dim text-text'
                  : 'border-line text-dim hover:border-acc'
              }`}
            >
              {m.venueName}
            </Link>
          ))}
        </nav>
      )}

      {/* Inviting is a role grant → AAL2 (RLS). Guide non-MFA managers to set it up. */}
      {ctx.isAal2 ? (
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
            Het toekennen van rollen vereist een MFA-geverifieerde sessie.{' '}
            <Link
              href={ctx.hasVerifiedTotp ? '/mfa/verify' : '/mfa/enroll'}
              className="text-acc-soft underline"
            >
              {ctx.hasVerifiedTotp ? 'Verifieer met je authenticator' : 'Stel MFA in'}
            </Link>
            .
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="label">Leden ({members.length})</h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold">{member.fullName}</p>
                <p className="text-faint text-sm">{member.email}</p>
              </div>
              <RoleBadges roles={member.roles} />
            </li>
          ))}
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
                  {ctx.isAal2 && <RevokeInviteButton inviteId={invite.id} />}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
