import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { getVenueMembers, getPendingInvitesForVenue } from '@/lib/auth/memberships';
import { getDashboardVenues, resolveActiveVenueId } from '@/lib/auth/active-venue';
import { canGrantRoles } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { InviteForm } from '@/features/auth/components/InviteForm';
import { DCard } from '@/components/po/desktop/kit';
import { TeamTable, type TeamMemberRow } from '@/features/venues/components/TeamTable';

export const metadata: Metadata = { title: 'Gebruikers — PLUSONE' };

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
      <div className="max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Gebruikers</h1>
        <p className="text-dim mt-2">Je hebt geen toegang tot teambeheer voor een venue.</p>
      </div>
    );
  }

  const activeId = await resolveActiveVenueId(dashboardVenues, venueParam);
  const active = dashboardVenues.find((m) => m.venueId === activeId) ?? dashboardVenues[0];
  const caps = venueCapabilities(active.roles);
  const callerIsAdmin = active.roles.includes('admin');
  const canManageInvites = caps.manageTeam && ctx.isAal2;

  const supabase = await createClient();
  const [members, pending, { data: venueRow }, { data: quotaRows }] = await Promise.all([
    getVenueMembers(active.venueId),
    getPendingInvitesForVenue(active.venueId),
    supabase.from('venues').select('default_personal_quota').eq('id', active.venueId).maybeSingle(),
    supabase.from('quotas').select('user_id, default_count').eq('venue_id', active.venueId),
  ]);

  const venueDefaultQuota = venueRow?.default_personal_quota ?? 0;
  const quotaByUser = new Map((quotaRows ?? []).map((q) => [q.user_id, q.default_count]));
  const adminCount = members.filter((m) => m.roles.includes('admin')).length;

  // Per-member management rights mirror the RLS USING clause: a user_manager
  // cannot touch an admin membership, and edits require an MFA-verified session.
  const rows: TeamMemberRow[] = members.map((m) => ({
    userId: m.userId,
    fullName: m.fullName,
    email: m.email,
    jobTitle: m.jobTitle,
    roles: m.roles,
    quota: quotaByUser.get(m.userId) ?? venueDefaultQuota,
    quotaIsOverride: quotaByUser.has(m.userId),
    exemptFromQuota: m.roles.includes('admin'),
    canManage: caps.manageTeam && ctx.isAal2 && canGrantRoles(active.roles, m.roles),
    isLastAdmin: m.roles.includes('admin') && adminCount === 1,
  }));

  return (
    <div className="flex max-w-5xl flex-col gap-[22px]">
      <header>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em]">Gebruikers</h1>
        <p className="text-faint mt-0.5 text-[13.5px]">
          Leden, rollen en uitnodigingen voor <span className="text-text">{active.venueName}</span>
          {!caps.manageTeam && <span className="text-faint"> · alleen-lezen</span>}.
        </p>
      </header>

      {/* Inviting is a role grant → AAL2 (RLS). Managers only; guide non-MFA managers. */}
      {caps.manageTeam &&
        (ctx.isAal2 ? (
          <DCard className="p-6">
            <h2 className="font-display mb-1 text-[17px] font-bold">Gebruiker uitnodigen</h2>
            <p className="text-faint mb-4 text-[13px]">
              De uitnodiging maakt een account aan; de eerste OTP-login activeert het. Uitnodigingen
              verlopen na 7 dagen.
            </p>
            <InviteForm venueId={active.venueId} callerIsAdmin={callerIsAdmin} />
          </DCard>
        ) : (
          <DCard className="border-acc-dim bg-acc-dim p-4 text-sm">
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
          </DCard>
        ))}

      <TeamTable
        venueId={active.venueId}
        venueName={active.venueName}
        callerIsAdmin={callerIsAdmin}
        canManageInvites={canManageInvites}
        members={rows}
        invites={pending.map((p) => ({
          id: p.id,
          email: p.email,
          roles: p.roles,
          expiresAt: p.expiresAt,
        }))}
      />
    </div>
  );
}
